/**
 * CLI-side device-key delegation: minting + client-side chain verification.
 *
 * Two responsibilities, both rooted in the author's PRIMARY key:
 *
 *   1. MINT (CLI, `skillet device approve|revoke`): build a DelegationCert /
 *      RevocationStatement and sign it with the primary key loaded from the
 *      keystore. The primary PRIVATE key never leaves this process — we only
 *      ever pass it to `signEnvelope` (the same audited primitive used for
 *      publish/propose), never serialize it.
 *
 *   2. VERIFY (client, at sync/materialize): given a device-signed version and
 *      its inline SignedDelegation, re-verify the chain
 *
 *        version.signature ← device_pub ← cert ← cert_sig ← PRIMARY key
 *
 *      where the PRIMARY key is the client's TOFU-PINNED key (signing/pin.ts),
 *      **never** the registry-served one (design §9.4). Fail-closed: any missing,
 *      malformed, out-of-chain, revoked, expired, or out-of-scope link throws.
 *
 * This module introduces NO new crypto: certs/revocations are hashed to a
 * `sha256:<hex>` string by @skillet/protocol and signed/verified through the
 * existing envelope path. The wire shapes + canonicalization + hashing are
 * imported from @skillet/protocol so the bytes the CLI signs are byte-identical
 * to the bytes the registry and client verify (design §9.6 / §9.7).
 */

import { randomBytes, type KeyObject } from "node:crypto";
import {
  type DelegationCert,
  type SignedDelegation,
  type RevocationStatement,
  type SignedRevocation,
  type DelegationScope,
  DELEGATION_CERT_VERSION,
  DELEGATION_CERT_TYP,
  DELEGATION_REVOCATION_TYP,
  DELEGABLE_SCOPES,
  DEFAULT_DELEGATION_TTL_SEC,
  MAX_DELEGATION_TTL_SEC,
  delegationCertHash,
  revocationHash,
  validateDelegationCert,
} from "@skillet/protocol";
import {
  signEnvelope,
  verifyEnvelope,
  type Ed25519Signature,
  type Signature,
} from "./envelope.js";
import { publicKeyFromBase64 } from "./pin.js";
import { type AuthorKey } from "./index.js";

const ED25519_RAW_PUB_BYTES = 32;
const KEY_ID_RE = /^[0-9a-f]{64}$/;

/**
 * Fail-closed error for the delegation chain. Carries a machine-readable code so
 * callers (pull, materialize, CLI) can map it the same way they map
 * {@link SignatureError}. A device-signed version that hits ANY of these MUST
 * NOT be materialized (design §9.3).
 */
export type DelegationErrorCode =
  | "delegation_missing" // device-keyed version with no inline cert (T9 downgrade)
  | "delegation_revoked" // device key appears in the author's revocation set
  | "delegation_expired" // version published outside the cert's signed validity window
  | "delegation_scope_denied" // cert not authorized for the required action
  | "delegation_invalid"; // cert shape/policy/binding failure

export class DelegationError extends Error {
  readonly code: DelegationErrorCode;
  constructor(code: DelegationErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "DelegationError";
    this.code = code;
  }
}

// ── minting (CLI, primary-key-resident) ──────────────────────────────────────

/** Validate + normalize a base64 raw-32-byte device pubkey → its hex key id. */
export function deviceKeyIdFromPub(devicePubB64: string): string {
  const raw = Buffer.from(devicePubB64, "base64");
  // Buffer.from(base64) is lenient (ignores junk); round-trip to reject
  // anything that does not re-encode to the exact same string.
  if (raw.toString("base64") !== devicePubB64) {
    throw new DelegationError("delegation_invalid", "device_pub is not valid base64");
  }
  if (raw.length !== ED25519_RAW_PUB_BYTES) {
    throw new DelegationError(
      "delegation_invalid",
      `device_pub must decode to ${ED25519_RAW_PUB_BYTES} bytes, got ${raw.length}`,
    );
  }
  return raw.toString("hex");
}

export interface MintDelegationOptions {
  /** Primary author key WITH its private half (from the keystore). */
  primaryKey: AuthorKey;
  /** The author's registry handle — bound into the cert (design §1.1, T6). */
  handle: string;
  /** Base64 raw 32-byte Ed25519 public key presented by the device/browser. */
  devicePubB64: string;
  /** Subset of {propose,approve}. Defaults to BOTH (design §4.1). */
  scopes?: DelegationScope[];
  /** Lifetime in seconds. Defaults to 90d; hard-capped at MAX_DELEGATION_TTL_SEC. */
  ttlSec?: number;
  /** Optional human label echoed by `skillet device list`. */
  label?: string;
  /** Injectable clock (unix seconds) for deterministic tests. */
  now?: number;
}

/**
 * Mints + signs a DelegationCert with the primary key. The returned
 * {@link SignedDelegation} is what `skillet device approve` POSTs to
 * `/api/v1/delegations`. `label` is returned alongside (the wire body carries
 * it as a sibling field, not inside the signed cert).
 */
export function mintDelegation(opts: MintDelegationOptions): {
  signed: SignedDelegation;
  label?: string;
} {
  if (!opts.primaryKey.privateKey) {
    throw new DelegationError(
      "delegation_invalid",
      "minting a delegation requires the primary private key (keystore key)",
    );
  }
  if (!KEY_ID_RE.test(opts.primaryKey.keyId)) {
    throw new DelegationError("delegation_invalid", "primary key id is not 64-char hex");
  }
  if (typeof opts.handle !== "string" || opts.handle.length === 0) {
    throw new DelegationError("delegation_invalid", "handle must be a non-empty string");
  }

  const deviceKeyId = deviceKeyIdFromPub(opts.devicePubB64);
  const scopes = opts.scopes ?? [...DELEGABLE_SCOPES];
  if (scopes.length === 0) {
    throw new DelegationError("delegation_scope_denied", "scopes must be non-empty");
  }
  for (const s of scopes) {
    if (!(DELEGABLE_SCOPES as readonly string[]).includes(s)) {
      throw new DelegationError(
        "delegation_scope_denied",
        `scope ${JSON.stringify(s)} is not delegable; allowed: ${DELEGABLE_SCOPES.join(", ")}`,
      );
    }
  }

  const issuedAt = opts.now ?? Math.floor(Date.now() / 1000);
  const requestedTtl = opts.ttlSec ?? DEFAULT_DELEGATION_TTL_SEC;
  if (!Number.isInteger(requestedTtl) || requestedTtl <= 0) {
    throw new DelegationError("delegation_invalid", "ttlSec must be a positive integer");
  }
  const ttl = Math.min(requestedTtl, MAX_DELEGATION_TTL_SEC);

  const cert: DelegationCert = {
    v: DELEGATION_CERT_VERSION,
    typ: DELEGATION_CERT_TYP,
    author_key_id: opts.primaryKey.keyId,
    handle: opts.handle,
    device_key_id: deviceKeyId,
    device_pub: opts.devicePubB64,
    scopes,
    issued_at: issuedAt,
    expires_at: issuedAt + ttl,
    nonce: randomBytes(16).toString("hex"),
  };

  // Defense-in-depth: never sign a cert that would not validate on the registry.
  const shape = validateDelegationCert(cert);
  if (!("ok" in shape)) {
    throw new DelegationError("delegation_invalid", `minted cert failed validation: ${shape.message}`);
  }

  const certHash = delegationCertHash(cert);
  const cert_sig: Signature = signEnvelope(certHash, opts.primaryKey);

  return {
    signed: { cert, cert_sig },
    ...(opts.label ? { label: opts.label } : {}),
  };
}

export interface MintRevocationOptions {
  primaryKey: AuthorKey;
  /** Hex id (== hex(device_pub)) of the device key being revoked. */
  deviceKeyId: string;
  now?: number;
}

/**
 * Mints + signs a RevocationStatement with the primary key. This is what
 * `skillet device revoke` POSTs to `/api/v1/delegations/:id/revoke`. Only the
 * primary key can authorize a trust-chain state change (design §3).
 */
export function mintRevocation(opts: MintRevocationOptions): SignedRevocation {
  if (!opts.primaryKey.privateKey) {
    throw new DelegationError(
      "delegation_invalid",
      "minting a revocation requires the primary private key (keystore key)",
    );
  }
  if (!KEY_ID_RE.test(opts.deviceKeyId)) {
    throw new DelegationError("delegation_invalid", "device_key_id must be 64-char lowercase hex");
  }

  const revocation: RevocationStatement = {
    v: DELEGATION_CERT_VERSION,
    typ: DELEGATION_REVOCATION_TYP,
    author_key_id: opts.primaryKey.keyId,
    device_key_id: opts.deviceKeyId,
    revoked_at: opts.now ?? Math.floor(Date.now() / 1000),
    nonce: randomBytes(16).toString("hex"),
  };

  const revHash = revocationHash(revocation);
  const revocation_sig: Signature = signEnvelope(revHash, opts.primaryKey);
  return { revocation, revocation_sig };
}

// ── client-side chain verification (TOFU-pinned primary is the root) ──────────

/**
 * Verifies a SignedDelegation's cert against the PINNED primary key — i.e. that
 * the cert was genuinely signed by `pinnedPrimary` and binds to it. Does NOT
 * verify any version/proposal signature; that's the caller's next step.
 *
 * Throws {@link DelegationError}/{@link SignatureError} (fail-closed) on any
 * shape, binding, or signature failure.
 */
export function verifyDelegationCert(
  signed: SignedDelegation,
  pinnedPrimary: { keyId: string; pub: string },
): DelegationCert {
  if (!signed || typeof signed !== "object" || !signed.cert || !signed.cert_sig) {
    throw new DelegationError("delegation_invalid", "signed delegation missing cert/cert_sig");
  }
  const shape = validateDelegationCert(signed.cert);
  if (!("ok" in shape)) {
    throw new DelegationError("delegation_invalid", `delegation cert invalid: ${shape.message}`);
  }
  const cert = shape.cert;

  // The cert must bind to, and be signed by, the TOFU-pinned primary key — not
  // any key the registry happens to serve (design §9.1/§9.4, T1).
  if (cert.author_key_id !== pinnedPrimary.keyId) {
    throw new DelegationError(
      "delegation_invalid",
      `delegation cert author_key_id ${cert.author_key_id} does not match pinned primary ${pinnedPrimary.keyId}`,
    );
  }
  if (signed.cert_sig.key_id !== pinnedPrimary.keyId) {
    throw new DelegationError(
      "delegation_invalid",
      `delegation cert_sig key_id ${signed.cert_sig.key_id} is not the pinned primary key`,
    );
  }

  // Recompute the hash from the cert and verify cert_sig against the pinned
  // primary public key. verifyEnvelope throws on any failure.
  const certHash = delegationCertHash(cert);
  const primaryPub: KeyObject = publicKeyFromBase64(pinnedPrimary.pub);
  verifyEnvelope(certHash, signed.cert_sig, primaryPub, {
    expectedKeyId: pinnedPrimary.keyId,
  });

  return cert;
}

export interface VerifyDelegatedVersionOptions {
  /** Canonical `sha256:<hex>` content hash that `versionSignature` covers. */
  contentHash: string;
  /** The version's signature envelope (key_id is the DEVICE key id here). */
  versionSignature: Ed25519Signature;
  /** The inline SignedDelegation served with the version / pinned in the lockfile. */
  signedDelegation: SignedDelegation | null | undefined;
  /** The client's TOFU-pinned primary key for this author (the trust root). */
  pinnedPrimary: { keyId: string; pub: string };
  /** The author handle the version belongs to — must equal cert.handle (T6). */
  handle: string;
  /** Action scope to require in the cert. Minted versions are owner-signed ⇒ 'approve'. */
  requiredScope: DelegationScope;
  /**
   * Unix-seconds timestamp the version was published. The cert MUST have been
   * valid at this instant (design §5: a cert valid when a version was minted
   * keeps that version valid). Falls back to `now` if omitted (stricter).
   */
  publishedAt?: number;
  /**
   * Device key ids the author has revoked (pulled on sync). If the version's
   * device key is in this set, the version is refused (design §3.4 / AC#3).
   */
  revokedDeviceKeyIds?: Iterable<string>;
  now?: number;
}

/**
 * Full client-side chain verification for a DEVICE-signed version (design §1.3).
 * Call this ONLY when `versionSignature.key_id` is not the primary key id.
 *
 * Order (all fail-closed):
 *   1. inline delegation present                      → else delegation_missing
 *   2. cert validates + chains to pinned primary      → verifyDelegationCert
 *   3. version sig key_id == cert.device_key_id       → binds version↔cert
 *   4. cert.handle == handle                          → T6
 *   5. device key not revoked                          → delegation_revoked
 *   6. publishedAt within [issued_at, expires_at]      → delegation_expired
 *   7. requiredScope ∈ cert.scopes                     → delegation_scope_denied
 *   8. version sig verifies against cert.device_pub    → SignatureError
 *
 * On success returns the verified device key id. Throws otherwise — the caller
 * MUST treat any throw as a hard stop and refuse materialization.
 */
export function verifyDelegatedVersionSignature(
  opts: VerifyDelegatedVersionOptions,
): { deviceKeyId: string; via: "delegation" } {
  if (!opts.signedDelegation) {
    throw new DelegationError(
      "delegation_missing",
      "version is signed by a device key but carries no delegation cert — refusing (no downgrade)",
    );
  }

  // 2 — cert validates and chains to the pinned primary (the trust root).
  const cert = verifyDelegationCert(opts.signedDelegation, opts.pinnedPrimary);

  // 3 — the version signature's key_id must be exactly the delegated device key.
  if (opts.versionSignature.key_id !== cert.device_key_id) {
    throw new DelegationError(
      "delegation_invalid",
      `version signed by ${opts.versionSignature.key_id} but delegation is for device ${cert.device_key_id}`,
    );
  }

  // 4 — handle binding.
  if (cert.handle !== opts.handle) {
    throw new DelegationError(
      "delegation_invalid",
      `delegation cert handle ${JSON.stringify(cert.handle)} does not match author ${JSON.stringify(opts.handle)}`,
    );
  }

  // 5 — revocation honoring (negative info pulled on sync).
  if (opts.revokedDeviceKeyIds) {
    const revoked =
      opts.revokedDeviceKeyIds instanceof Set
        ? opts.revokedDeviceKeyIds
        : new Set(opts.revokedDeviceKeyIds);
    if (revoked.has(cert.device_key_id)) {
      throw new DelegationError(
        "delegation_revoked",
        `device key ${cert.device_key_id} has been revoked by the author`,
      );
    }
  }

  // 6 — the cert must have been valid at publish time (design §5).
  const at = opts.publishedAt ?? opts.now ?? Math.floor(Date.now() / 1000);
  if (at < cert.issued_at || at > cert.expires_at) {
    throw new DelegationError(
      "delegation_expired",
      `version published at ${at} is outside the cert validity window [${cert.issued_at}, ${cert.expires_at}]`,
    );
  }

  // 7 — scope gate.
  if (!cert.scopes.includes(opts.requiredScope)) {
    throw new DelegationError(
      "delegation_scope_denied",
      `device key is not authorized for ${opts.requiredScope} (scopes: ${cert.scopes.join(", ")})`,
    );
  }

  // 8 — finally, verify the version signature against the device pub taken ONLY
  // from inside the now-verified cert (never an unsigned column) — design §9.2.
  const devicePub = publicKeyFromBase64(cert.device_pub);
  verifyEnvelope(opts.contentHash, opts.versionSignature, devicePub, {
    expectedKeyId: cert.device_key_id,
  });

  return { deviceKeyId: cert.device_key_id, via: "delegation" };
}
