// PROTOCOL §4 — registry-side author signing verification.
//
// The trust root is the author key, not the registry. We verify here so a
// caller who is somehow allowed to POST cannot claim authorship of bytes
// they did not sign with the key registered at /claim time. Verifies that
// envelope.sig was produced by author_public_key over signatureBytes(content_hash).
//
// Wire shape (same as @skillet/core/signing/envelope.ts):
//   { alg: "ed25519", key_id: <64-char-hex>, sig: <base64-64-bytes> }
//
// Inputs the signer signs (the "signatureBytes"):
//   utf8(content_hash)   where content_hash = "sha256:" + 64-char-hex (§2.2)
//
// Implemented inline (not via @skillet/core) so the registry has no client-side
// dep. If they ever drift, the contract is the protocol — both implementations
// MUST produce/accept the exact same bytes-on-the-wire.

import { createPublicKey, verify, type KeyObject } from 'node:crypto';
import {
  BUNDLE_SIG_TYP,
  bundleSignatureBytes,
  isBundleSignatureV2,
  keyBindPopMessageBytes,
} from '@skillet/protocol';
import type { AuthorKey } from '../db/index.js';

export const SIG_ALG_ED25519 = 'ed25519' as const;

export interface Signature {
  alg: typeof SIG_ALG_ED25519;
  key_id: string;
  sig: string;
  /**
   * Signature scheme version carried on the wire envelope. v2 binds
   * author_key_id + ref + version + content_hash; v1 (or absent) signs the
   * content_hash only. Persisted to `skill_versions.sig_version` at publish.
   */
  sig_version?: number;
}

const KEY_ID_RE = /^[0-9a-f]{64}$/;
const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const ED25519_SIG_BYTES = 64;
const ED25519_RAW_PUB_BYTES = 32;

export type SignatureFailureCode =
  | 'signature_invalid'
  | 'key_id_mismatch'
  | 'author_not_claimed';

export interface SignatureFailure {
  code: SignatureFailureCode;
  message: string;
}

export interface SignatureOk {
  ok: true;
}

export interface PublishSignatureBinding {
  ref: string;
  version: number;
}

/**
 * Verify an Ed25519 publish envelope against the author's full key set.
 * Any non-revoked key bound to the author is a valid trust root — callers must
 * pass ALL active keys via getAuthorKeys(db, userId). An empty array means the
 * author has never claimed a key (author_not_claimed). A non-empty array where
 * no entry matches the envelope key_id returns key_id_mismatch.
 */
export function verifyPublishSignature(
  contentHash: string,
  envelope: unknown,
  authorKeys: AuthorKey[],
  binding?: PublishSignatureBinding,
): SignatureOk | SignatureFailure {
  if (authorKeys.length === 0) {
    return {
      code: 'author_not_claimed',
      message:
        'publishing author has no registered Ed25519 key — call /api/v1/claim first',
    };
  }

  if (!envelope || typeof envelope !== 'object') {
    return { code: 'signature_invalid', message: 'signature envelope missing' };
  }
  const env = envelope as Record<string, unknown>;
  if (env.alg !== SIG_ALG_ED25519) {
    return {
      code: 'signature_invalid',
      message: `unsupported alg ${JSON.stringify(env.alg)}; only ed25519 in v1`,
    };
  }
  if (typeof env.key_id !== 'string' || !KEY_ID_RE.test(env.key_id)) {
    return {
      code: 'signature_invalid',
      message: 'envelope key_id must be 64-char lowercase hex',
    };
  }
  if (typeof env.sig !== 'string' || env.sig.length === 0) {
    return { code: 'signature_invalid', message: 'envelope sig missing' };
  }

  // Resolve the signing key from the author's bound key set.
  const matchedKey = authorKeys.find((k) => k.key_id === env.key_id);
  if (!matchedKey) {
    return {
      code: 'key_id_mismatch',
      message:
        'envelope key_id does not match any non-revoked key bound to this author',
    };
  }

  if (!CONTENT_HASH_RE.test(contentHash)) {
    // Defensive — the caller computes content_hash internally, so this is a
    // bug in the registry, not a client problem. Surface loudly.
    return {
      code: 'signature_invalid',
      message: `internal: content_hash shape ${JSON.stringify(contentHash)} does not match sha256:<64hex>`,
    };
  }

  let pubKey: KeyObject;
  try {
    pubKey = publicKeyFromBase64(matchedKey.public_key);
  } catch (err) {
    return {
      code: 'signature_invalid',
      message: `registered author key could not be parsed: ${(err as Error).message}`,
    };
  }

  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(env.sig, 'base64');
  } catch {
    return { code: 'signature_invalid', message: 'sig is not valid base64' };
  }
  if (sigBytes.length !== ED25519_SIG_BYTES) {
    return {
      code: 'signature_invalid',
      message: `sig length ${sigBytes.length} (expected ${ED25519_SIG_BYTES})`,
    };
  }
  if (sigBytes.every((b) => b === 0)) {
    // All-zero sig fails legit Ed25519 verify, but we reject early so a
    // brittle verify path can't accept it on a future binding.
    return { code: 'signature_invalid', message: 'all-zero sig rejected' };
  }

  let message: Buffer;
  if (isBundleSignatureV2(env)) {
    if (!binding) {
      return {
        code: 'signature_invalid',
        message: 'v2 envelope requires ref and version binding at publish time',
      };
    }
    try {
      message = bundleSignatureBytes({
        typ: BUNDLE_SIG_TYP,
        author_key_id: matchedKey.key_id,
        ref: binding.ref,
        version: binding.version,
        content_hash: contentHash,
      });
    } catch (err) {
      return {
        code: 'signature_invalid',
        message: `v2 binding invalid: ${(err as Error).message}`,
      };
    }
  } else {
    message = Buffer.from(contentHash, 'utf8');
  }

  const ok = verify(null, message, pubKey, sigBytes);
  if (!ok) {
    return {
      code: 'signature_invalid',
      message: 'signature does not verify against content_hash',
    };
  }

  return { ok: true };
}

/**
 * Verify a PoP (proof-of-possession) signature for key bind.
 *
 * item 3: domain-separated message commits to the specific key being bound:
 *   utf8("skillet-key-bind:v1:" + nonce + ":" + keyId)
 *
 * Both pop_sig_new (new-key self-attestation) and pop_sig (existing-key co-sign)
 * MUST sign over this same message so neither signature can be transplanted to
 * authorise a different key_id.
 *
 * Returns true iff the signature verifies; never throws.
 */
export function verifyPopSignature(
  nonce: string,
  keyId: string,
  pubKeyB64: string,
  sigB64: string,
): boolean {
  try {
    const pubKey = publicKeyFromBase64(pubKeyB64);
    const sigBytes = Buffer.from(sigB64, 'base64');
    if (sigBytes.length !== ED25519_SIG_BYTES) return false;
    if (sigBytes.every((b) => b === 0)) return false;
    const message = keyBindPopMessageBytes(nonce, keyId);
    return verify(null, message, pubKey, sigBytes);
  } catch {
    return false;
  }
}

/** Convert a base64-encoded raw 32-byte Ed25519 public key to a Node KeyObject. */
function publicKeyFromBase64(b64: string): KeyObject {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== ED25519_RAW_PUB_BYTES) {
    throw new Error(
      `Invalid Ed25519 public key: expected ${ED25519_RAW_PUB_BYTES} raw bytes, got ${raw.length}`,
    );
  }
  const jwk = { kty: 'OKP', crv: 'Ed25519', x: raw.toString('base64url') };
  return createPublicKey({ key: jwk, format: 'jwk' });
}
