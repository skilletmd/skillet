// Author-signed device-key delegation (PROTOCOL §4 extension).
//
// A delegation certificate is an Ed25519-signed statement, signed by the
// author's PRIMARY key, that authorizes a device subkey to act (propose /
// approve) on the author's behalf for a bounded time and scope. The trust chain
// becomes:
//
//   proposal/approval sig ← device subkey ← signed delegation cert ← primary key
//
// This module is the SINGLE SOURCE OF TRUTH for the cert/revocation wire shapes,
// their canonical JSON serialization, and the hashed signing input. Both the
// registry (verify) and the CLI (mint + sign + client-side verify) import it, so
// the bytes that get signed and the bytes that get verified can never drift —
// drift would silently invalidate every delegation (see design §9.6 / §9.7).
//
// No new crypto primitive is introduced: the cert is hashed to a
// `sha256:<hex>` string and signed exactly like a bundle content_hash
// (signing/envelope.ts), i.e. Ed25519 over `utf8(certHash)`.

import { createHash } from 'node:crypto';

// ── constants ──────────────────────────────────────────────────────────────

export const DELEGATION_CERT_VERSION = 1 as const;
export const DELEGATION_CERT_TYP = 'skillet-delegation' as const;
export const DELEGATION_REVOCATION_TYP = 'skillet-delegation-revocation' as const;

/** Hard ceiling on a delegation's lifetime (design §2.3 step 5). 365 days. */
export const MAX_DELEGATION_TTL_SEC = 365 * 24 * 60 * 60;
/** CLI-default issuance window (informational; enforced cap is the max). 90 days. */
export const DEFAULT_DELEGATION_TTL_SEC = 90 * 24 * 60 * 60;

/**
 * Scopes a device key may hold when backed by an author-signed delegation cert.
 * `claim` is never delegable. `publish` requires the author to approve the device;
 * browser author_keys without a cert still cannot publish.
 */
export const DELEGABLE_SCOPES = ['propose', 'approve', 'publish'] as const;
export type DelegationScope = (typeof DELEGABLE_SCOPES)[number];

const KEY_ID_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{32}$/; // 16 random bytes, hex
const ED25519_RAW_PUB_BYTES = 32;

// ── wire shapes ──────────────────────────────────────────────────────────────

/** The signed payload (design §1.1). Canonicalized to JSON, hashed, then signed. */
export interface DelegationCert {
  v: number;
  typ: typeof DELEGATION_CERT_TYP;
  author_key_id: string; // primary key id; MUST equal users.author_key_id
  handle: string; // binds the cert to the registry identity
  device_key_id: string; // delegated subkey id (== hex of device_pub)
  device_pub: string; // base64 raw 32-byte Ed25519 public key of the device
  scopes: string[]; // subset of DELEGABLE_SCOPES
  issued_at: number; // unix seconds
  expires_at: number; // unix seconds; capped at issued_at + MAX_DELEGATION_TTL
  nonce: string; // 16 random bytes hex
}

/** Generic Ed25519 envelope (matches signing/envelope.ts Signature). */
export interface DelegationEnvelope {
  alg: 'ed25519';
  key_id: string;
  sig: string;
}

/** The stored/wire object: cert + the author primary-key signature over it. */
export interface SignedDelegation {
  cert: DelegationCert;
  cert_sig: DelegationEnvelope;
}

/** Author-signed revocation statement (design §3.1). */
export interface RevocationStatement {
  v: number;
  typ: typeof DELEGATION_REVOCATION_TYP;
  author_key_id: string;
  device_key_id: string;
  revoked_at: number;
  nonce: string;
}

export interface SignedRevocation {
  revocation: RevocationStatement;
  revocation_sig: DelegationEnvelope;
}

// ── canonical JSON (RFC 8785 JCS subset) ─────────────────────────────────────

/**
 * Deterministic canonical JSON: object keys sorted by UTF-16 code unit, no
 * insignificant whitespace, ECMAScript number formatting, minimal string
 * escaping (V8's JSON.stringify already matches JCS for our ASCII-only inputs).
 *
 * Restricted on purpose to the value types a cert/revocation can hold (string,
 * finite number, boolean, null, array, plain object). Anything else throws —
 * a malformed payload must never be silently coerced into signed bytes.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value);
}

function serialize(v: unknown): string {
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'string') return JSON.stringify(v);
  if (t === 'boolean') return v ? 'true' : 'false';
  if (t === 'number') {
    if (!Number.isFinite(v as number)) {
      throw new Error('canonicalJson: non-finite number is not serializable');
    }
    // JCS uses ECMAScript Number→String; for the integer inputs we sign this is exact.
    return String(v);
  }
  if (Array.isArray(v)) {
    return '[' + v.map((el) => serialize(el)).join(',') + ']';
  }
  if (t === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort(); // default sort == UTF-16 code unit order == JCS
    const parts: string[] = [];
    for (const k of keys) {
      const val = obj[k];
      if (val === undefined) continue; // undefined has no JSON form; skip like JSON.stringify
      parts.push(JSON.stringify(k) + ':' + serialize(val));
    }
    return '{' + parts.join(',') + '}';
  }
  throw new Error(`canonicalJson: unsupported value type ${t}`);
}

/** `sha256:` + hex(sha256(canonicalJson(cert))) — the string that gets signed. */
export function delegationCertHash(cert: DelegationCert): string {
  return 'sha256:' + createHash('sha256').update(Buffer.from(canonicalJson(cert), 'utf8')).digest('hex');
}

/** Same shape for the revocation statement (distinct `typ` ⇒ disjoint input). */
export function revocationHash(rev: RevocationStatement): string {
  return 'sha256:' + createHash('sha256').update(Buffer.from(canonicalJson(rev), 'utf8')).digest('hex');
}

// ── pure shape / policy validation (no crypto) ───────────────────────────────

export type DelegationCertValidationCode =
  | 'invalid_cert'
  | 'invalid_device_key'
  | 'invalid_scope'
  | 'invalid_expiry';

export interface DelegationCertValidationFailure {
  code: DelegationCertValidationCode;
  message: string;
}

/**
 * Validates a DelegationCert's structure and policy (NOT its signature):
 * version/typ, id/handle shapes, `device_key_id == hex(device_pub)`,
 * scopes ⊆ DELEGABLE_SCOPES (non-empty), and a positive TTL within the cap.
 *
 * Shared by registration (registry §2.3) and by every verify-time re-check so
 * the same rules apply when minting and when honoring a stored cert.
 */
export function validateDelegationCert(
  cert: unknown,
): { ok: true; cert: DelegationCert } | DelegationCertValidationFailure {
  if (!cert || typeof cert !== 'object') {
    return { code: 'invalid_cert', message: 'cert must be an object' };
  }
  const c = cert as Record<string, unknown>;

  if (c.v !== DELEGATION_CERT_VERSION) {
    return { code: 'invalid_cert', message: `unsupported cert version ${JSON.stringify(c.v)}` };
  }
  if (c.typ !== DELEGATION_CERT_TYP) {
    return { code: 'invalid_cert', message: `cert typ must be ${DELEGATION_CERT_TYP}` };
  }
  if (typeof c.author_key_id !== 'string' || !KEY_ID_RE.test(c.author_key_id)) {
    return { code: 'invalid_cert', message: 'author_key_id must be 64-char lowercase hex' };
  }
  if (typeof c.handle !== 'string' || c.handle.length === 0) {
    return { code: 'invalid_cert', message: 'handle must be a non-empty string' };
  }
  if (typeof c.device_key_id !== 'string' || !KEY_ID_RE.test(c.device_key_id)) {
    return { code: 'invalid_device_key', message: 'device_key_id must be 64-char lowercase hex' };
  }
  if (typeof c.device_pub !== 'string' || c.device_pub.length === 0) {
    return { code: 'invalid_device_key', message: 'device_pub must be a non-empty base64 string' };
  }
  // device_key_id MUST equal hex(device_pub) — binds the indexable id to the
  // signed key bytes so they can never disagree (design §1.1, T7).
  let devRaw: Buffer;
  try {
    devRaw = Buffer.from(c.device_pub, 'base64');
  } catch {
    return { code: 'invalid_device_key', message: 'device_pub is not valid base64' };
  }
  if (devRaw.length !== ED25519_RAW_PUB_BYTES) {
    return {
      code: 'invalid_device_key',
      message: `device_pub must decode to ${ED25519_RAW_PUB_BYTES} bytes, got ${devRaw.length}`,
    };
  }
  if (devRaw.toString('hex') !== c.device_key_id) {
    return { code: 'invalid_device_key', message: 'device_key_id must equal hex(device_pub)' };
  }
  if (typeof c.nonce !== 'string' || !NONCE_RE.test(c.nonce)) {
    return { code: 'invalid_cert', message: 'nonce must be 32-char lowercase hex (16 bytes)' };
  }

  if (!Array.isArray(c.scopes) || c.scopes.length === 0) {
    return { code: 'invalid_scope', message: 'scopes must be a non-empty array' };
  }
  for (const s of c.scopes) {
    if (typeof s !== 'string' || !(DELEGABLE_SCOPES as readonly string[]).includes(s)) {
      return {
        code: 'invalid_scope',
        message: `scope ${JSON.stringify(s)} is not delegable; allowed: ${DELEGABLE_SCOPES.join(', ')}`,
      };
    }
  }

  if (
    typeof c.issued_at !== 'number' ||
    !Number.isInteger(c.issued_at) ||
    typeof c.expires_at !== 'number' ||
    !Number.isInteger(c.expires_at)
  ) {
    return { code: 'invalid_expiry', message: 'issued_at and expires_at must be integer unix seconds' };
  }
  const ttl = c.expires_at - c.issued_at;
  if (ttl <= 0) {
    return { code: 'invalid_expiry', message: 'expires_at must be after issued_at' };
  }
  if (ttl > MAX_DELEGATION_TTL_SEC) {
    return {
      code: 'invalid_expiry',
      message: `delegation TTL ${ttl}s exceeds cap ${MAX_DELEGATION_TTL_SEC}s`,
    };
  }

  return { ok: true, cert: c as unknown as DelegationCert };
}
