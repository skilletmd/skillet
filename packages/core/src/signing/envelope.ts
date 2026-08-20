/**
 * Skillet author-signing envelope (PROTOCOL §4).
 *
 * Wire shape — versionable, embedded in publish bodies, manifests, lockfiles:
 *   { "alg": "ed25519", "key_id": "<hex>", "sig": "<base64>" }
 *
 * Signing input — what the bytes-on-the-wire actually mean — is THE bytes of
 * the `content_hash` string ("sha256:" + 64 lowercase hex), UTF-8 encoded.
 * That is the contract subtask 1 (canonical hash) plugs into: it
 * controls what value goes into `content_hash`; this envelope says how those
 * bytes are turned into a signature.
 *
 * Why sign the string, not the raw 32-byte digest:
 *   - The string is what every endpoint, response, lockfile, and log shows.
 *     A byte-identical contract end-to-end removes ambiguity about which
 *     value got signed and is what the spec writes verbatim (§4).
 *   - "key_id" + "alg" leave room for v2 rotation / Sigstore without a
 *     breaking envelope change.
 *
 * Verification is fail-closed. A bad signature aborts that skill and leaves
 * the existing materialized files untouched (§6.4, acceptance criterion 3).
 */
import { sign, verify, type KeyObject } from "node:crypto";
import {
  BUNDLE_SIG_TYP,
  bundleSignatureBytes,
  isBundleSignatureV2,
  type BundleSignaturePayload,
} from "@skillet/protocol";

export const SIG_ALG_ED25519 = "ed25519" as const;
export const SIG_ALG_SESSION = "session" as const;

export type SigAlg = typeof SIG_ALG_ED25519 | typeof SIG_ALG_SESSION;

export interface Ed25519Signature {
  alg: typeof SIG_ALG_ED25519;
  key_id: string;
  sig: string;
  /** 2 = binds author/ref/version/content_hash (NF-004). Absent = legacy v1. */
  sig_version?: 1 | 2;
}

export interface EnvelopeBinding {
  ref: string;
  version: number;
  authorKeyId: string;
}

/** Build v2 binding context from a kit entry or manifest slug. */
export function envelopeBindingFromSlug(
  slug: string,
  version: number,
  authorKeyId: string,
  owner?: string | null,
  name?: string | null,
): EnvelopeBinding {
  if (slug.startsWith("@")) {
    return { ref: slug, version, authorKeyId };
  }
  const author = owner ?? slug.split("/")[0] ?? "";
  const skillName = name ?? slug.split("/").slice(1).join("/") ?? slug;
  return { ref: `@${author}/${skillName}`, version, authorKeyId };
}

export interface SessionAttestedSignature {
  alg: typeof SIG_ALG_SESSION;
  key_id: string;
  sig: string;
}

export type Signature = Ed25519Signature | SessionAttestedSignature;

const VALID_KEY_ID_RE = /^[0-9a-f]{64}$/;
const CONTENT_HASH_RE = /^sha256:[0-9a-f]{64}$/;
const ED25519_SIG_BYTES = 64;

/**
 * Returns the canonical bytes-to-sign for a content_hash string.
 * MUST be called by both signers and verifiers — never sign raw digests
 * directly, the string form is what the protocol writes (§4).
 */
export function signatureBytes(contentHash: string): Buffer {
  if (!CONTENT_HASH_RE.test(contentHash)) {
    throw new Error(
      `signatureBytes: contentHash must match /^sha256:[0-9a-f]{64}$/, got ${JSON.stringify(contentHash)}`
    );
  }
  return Buffer.from(contentHash, "utf8");
}

/**
 * Produces a wire-shaped signature envelope for the given content hash.
 * `key` MUST carry a private half; throws otherwise.
 */
export function signEnvelope(
  contentHash: string,
  key: { keyId: string; privateKey?: KeyObject },
  opts: { binding?: EnvelopeBinding } = {},
): Ed25519Signature {
  if (!key.privateKey) {
    throw new Error(
      "signEnvelope: private key is undefined (verification-only key)"
    );
  }
  if (!VALID_KEY_ID_RE.test(key.keyId)) {
    throw new Error(
      `signEnvelope: invalid key_id ${JSON.stringify(key.keyId)} (expected 64-char lowercase hex)`
    );
  }
  const binding = opts.binding;
  if (binding && binding.authorKeyId !== key.keyId) {
    throw new Error("signEnvelope: binding.authorKeyId must match signing key");
  }
  const message =
    binding != null
      ? bundleSignatureBytes({
          typ: BUNDLE_SIG_TYP,
          author_key_id: binding.authorKeyId,
          ref: binding.ref,
          version: binding.version,
          content_hash: contentHash,
        })
      : signatureBytes(contentHash);
  const sig = sign(null, message, key.privateKey);
  return {
    alg: SIG_ALG_ED25519,
    key_id: key.keyId,
    sig: sig.toString("base64"),
    ...(binding ? { sig_version: 2 as const } : {}),
  };
}

/**
 * Verifies an envelope against a public key. Throws (does not return false)
 * for every failure mode so callers cannot accidentally drop the result.
 *
 * Error codes (machine-readable, matching PROTOCOL §0 + acceptance criteria):
 *   - "signature_invalid"  — envelope shape, alg, key_id, or sig bytes are bad
 *   - "key_id_mismatch"    — envelope key_id does not match the pinned key
 *   - "integrity_failed"   — sig does not verify against (contentHash, pubKey)
 */
export function verifyEnvelope(
  contentHash: string,
  envelope: Ed25519Signature,
  publicKey: KeyObject,
  opts: { expectedKeyId?: string; binding?: EnvelopeBinding } = {}
): void {
  if (!envelope || envelope.alg !== SIG_ALG_ED25519) {
    throw new SignatureError(
      "signature_invalid",
      `unsupported alg ${JSON.stringify(envelope?.alg)}`
    );
  }
  if (!VALID_KEY_ID_RE.test(envelope.key_id)) {
    throw new SignatureError(
      "signature_invalid",
      `invalid key_id ${JSON.stringify(envelope.key_id)}`
    );
  }
  if (opts.expectedKeyId && opts.expectedKeyId !== envelope.key_id) {
    throw new SignatureError(
      "key_id_mismatch",
      `envelope key_id ${envelope.key_id} does not match pinned ${opts.expectedKeyId}`
    );
  }
  if (!envelope.sig) {
    throw new SignatureError("signature_invalid", "missing sig");
  }

  let sigBytes: Buffer;
  try {
    sigBytes = Buffer.from(envelope.sig, "base64");
  } catch {
    throw new SignatureError("signature_invalid", "sig is not valid base64");
  }
  if (sigBytes.length !== ED25519_SIG_BYTES) {
    throw new SignatureError(
      "signature_invalid",
      `sig length ${sigBytes.length} (expected ${ED25519_SIG_BYTES})`
    );
  }
  if (sigBytes.every((b) => b === 0)) {
    throw new SignatureError("signature_invalid", "all-zero sig rejected");
  }

  let message: Buffer;
  if (isBundleSignatureV2(envelope)) {
    if (!opts.binding) {
      throw new SignatureError(
        "signature_invalid",
        "v2 envelope requires binding context (ref, version, author_key_id)"
      );
    }
    const payload: BundleSignaturePayload = {
      typ: BUNDLE_SIG_TYP,
      author_key_id: opts.binding.authorKeyId,
      ref: opts.binding.ref,
      version: opts.binding.version,
      content_hash: contentHash,
    };
    message = bundleSignatureBytes(payload);
  } else {
    message = signatureBytes(contentHash);
  }

  const ok = verify(null, message, publicKey, sigBytes);
  if (!ok) {
    throw new SignatureError(
      "integrity_failed",
      isBundleSignatureV2(envelope)
        ? "signature does not verify against bundle binding"
        : "signature does not verify against content_hash"
    );
  }
}

export { isBundleSignatureV2 } from "@skillet/protocol";

export type SignatureErrorCode =
  | "signature_invalid"
  | "key_id_mismatch"
  | "integrity_failed";

export class SignatureError extends Error {
  readonly code: SignatureErrorCode;
  constructor(code: SignatureErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "SignatureError";
    this.code = code;
  }
}
