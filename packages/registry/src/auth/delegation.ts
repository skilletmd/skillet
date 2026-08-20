// Registry-side delegated-signature verification (design §2.4 / §9).
//
// `resolveAndVerifySigner` is the chokepoint the propose/approve paths call
// instead of `verifyPublishSignature` directly. It accepts a signature whose
// key_id is EITHER the user's primary author key (today's direct path) or a
// DEVICE key whose authority is established by an author-signed delegation cert.
//
// Mandatory invariants enforced here:
//   §9.1  Authority is RECOMPUTED, never trusted from columns. We re-canonicalize
//         the parsed cert and re-verify cert_sig against users.author_public_key.
//         The denormalized device_pub / author_key_id / scopes columns are NEVER
//         the verification input.
//   §9.2  The device pub used to verify the proposal/approval sig comes ONLY from
//         inside the signed cert.
//   §9.3  Fail-closed: missing / expired / revoked / out-of-scope ⇒ reject. No
//         partial acceptance, no silent fallthrough.
//   §9.5  `claim` is never delegable — only propose/approve/publish reach this resolver;
//         scopes are constrained to DELEGABLE_SCOPES at registration and re-checked.

import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaDb } from '../db/prisma-client.js';
import {
  type DelegationCert,
  type SignedDelegation,
  delegationCertHash,
  validateDelegationCert,
} from '@skillet/protocol';
import {
  verifyPublishSignature,
  type SignatureFailure,
  type SignatureFailureCode,
  type PublishSignatureBinding,
} from './signature.js';

export type DelegationFailureCode =
  | 'delegation_not_found'
  | 'delegation_revoked'
  | 'delegation_expired'
  | 'delegation_scope_denied';

export type ResolveSignerFailureCode = SignatureFailureCode | DelegationFailureCode;

export interface ResolveSignerFailure {
  code: ResolveSignerFailureCode;
  message: string;
}

export interface ResolveSignerOk {
  ok: true;
  /** The key id that actually produced the signature (device key when delegated). */
  signer_key_id: string;
  /**
   * The user's PRIMARY (CLI-origin) author key id — the trust root the chain
   * resolves to. Stored as `author_key_id` on a minted version even when the
   * signer is a device key, so the chain still roots in the primary key.
   */
  primary_key_id: string;
  via_delegation: boolean;
  /**
   * The full SignedDelegation used, present iff `via_delegation`. Callers store
   * this inline on the minted version (delegation_json) so a client can verify
   * the chain offline.
   */
  signed_delegation: SignedDelegation | null;
}

export type ResolveSignerResult = ResolveSignerOk | ResolveSignerFailure;

export type RequiredSignerScope = 'propose' | 'approve' | 'publish';

/**
 * Verify that `envelope` (an Ed25519 signature over `contentHash`) was produced
 * by `userId`'s authority — directly with the primary key, or via a valid,
 * in-scope, non-expired, non-revoked delegation chaining to that primary key.
 *
 * Returns a {@link ResolveSignerFailure} (never throws) so callers map the code
 * to a 422 exactly as they already do for `verifyPublishSignature`.
 *
 * Sqlite path retired; callers must use {@link resolveAndVerifySignerPrisma}.
 */
export function resolveAndVerifySigner(
  _db: DatabaseSync,
  _userId: string,
  _contentHash: string,
  _envelope: unknown,
  _requiredScope: RequiredSignerScope,
  _binding?: PublishSignatureBinding,
): ResolveSignerResult {
  throw new Error('sqlite registry store removed; use resolveAndVerifySignerPrisma');
}

/** We provide the Prisma counterpart of {@link resolveAndVerifySigner}. */
export async function resolveAndVerifySignerPrisma(
  prisma: PrismaDb,
  userId: string,
  contentHash: string,
  envelope: unknown,
  requiredScope: RequiredSignerScope,
  binding?: PublishSignatureBinding,
): Promise<ResolveSignerResult> {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { author_public_key: true, author_key_id: true, handle: true },
  });
  if (!user?.author_public_key || !user.author_key_id) {
    return {
      code: 'author_not_claimed',
      message: 'signing user has no registered Ed25519 key - call /api/v1/claim first',
    };
  }
  if (!envelope || typeof envelope !== 'object') {
    return { code: 'signature_invalid', message: 'signature envelope missing' };
  }
  const env = envelope as Record<string, unknown>;
  if (typeof env.key_id !== 'string') {
    return { code: 'signature_invalid', message: 'envelope key_id missing' };
  }

  if (env.key_id === user.author_key_id) {
    const direct = verifyPublishSignature(
      contentHash,
      envelope,
      [{ key_id: user.author_key_id, public_key: user.author_public_key }],
      binding,
    );
    if ('code' in direct) return direct;
    return {
      ok: true,
      signer_key_id: user.author_key_id,
      primary_key_id: user.author_key_id,
      via_delegation: false,
      signed_delegation: null,
    };
  }

  const row = await prisma.author_delegations.findFirst({
    where: { device_key_id: env.key_id, user_id: userId },
    select: {
      cert_json: true,
      cert_sig_alg: true,
      cert_sig_key_id: true,
      cert_sig_b64: true,
      revoked_at: true,
      expires_at: true,
    },
  });
  if (!row) {
    return {
      code: 'delegation_not_found',
      message: 'no delegation registered for this device key under the signing author',
    };
  }
  if (row.revoked_at != null) {
    return { code: 'delegation_revoked', message: 'this device key delegation has been revoked' };
  }
  const now = Math.floor(Date.now() / 1000);
  if (now > row.expires_at) {
    return { code: 'delegation_expired', message: 'this device key delegation has expired' };
  }

  let cert: DelegationCert;
  try {
    cert = JSON.parse(row.cert_json) as DelegationCert;
  } catch {
    return { code: 'signature_invalid', message: 'stored delegation cert_json is corrupt' };
  }
  const shape = validateDelegationCert(cert);
  if (!('ok' in shape)) {
    return {
      code: 'signature_invalid',
      message: `stored delegation cert is invalid: ${shape.message}`,
    };
  }
  if (cert.author_key_id !== user.author_key_id) {
    return {
      code: 'signature_invalid',
      message: 'delegation cert author_key_id does not match the signing author',
    };
  }
  if (user.handle != null && cert.handle !== user.handle) {
    return {
      code: 'signature_invalid',
      message: 'delegation cert handle does not match the signing author',
    };
  }
  if (!cert.scopes.includes(requiredScope)) {
    return {
      code: 'delegation_scope_denied',
      message: `device key is not authorized for ${requiredScope}`,
    };
  }

  const certSig = {
    alg: row.cert_sig_alg as 'ed25519',
    key_id: row.cert_sig_key_id,
    sig: row.cert_sig_b64,
  };
  if (certSig.key_id !== user.author_key_id) {
    return {
      code: 'signature_invalid',
      message: 'delegation cert_sig key_id is not the author primary key',
    };
  }
  const certCheck = verifyPublishSignature(
    delegationCertHash(cert),
    certSig,
    [{ key_id: user.author_key_id, public_key: user.author_public_key }],
  );
  if ('code' in certCheck) {
    return {
      code: 'signature_invalid',
      message: `delegation cert signature does not verify against the author primary key: ${certCheck.message}`,
    };
  }
  if (now > cert.expires_at) {
    return { code: 'delegation_expired', message: 'this device key delegation has expired' };
  }
  const deviceCheck = verifyPublishSignature(
    contentHash,
    envelope,
    [{ key_id: cert.device_key_id, public_key: cert.device_pub }],
    binding,
  );
  if ('code' in deviceCheck) {
    return {
      code: 'signature_invalid',
      message: `device signature does not verify against the delegated key: ${deviceCheck.message}`,
    };
  }
  return {
    ok: true,
    signer_key_id: cert.device_key_id,
    primary_key_id: user.author_key_id,
    via_delegation: true,
    signed_delegation: { cert, cert_sig: certSig },
  };
}

// Re-exported for callers that already import the failure shape from signature.ts.
export type { SignatureFailure };
