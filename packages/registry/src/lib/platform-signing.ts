// Platform attestation signing — the registry's own Ed25519 identity for
// content it produces itself (GitHub mirrors, seeds). PROTOCOL §4 assumes an
// author key signs every version; mirrored bundles have no author to sign
// them, so device sync rejected them (`unsigned_version`). The platform key
// closes that gap: such versions are signed v2 (key + ref + version +
// content_hash) and served with the platform key as the version-level author
// identity, so already-shipped clients verify and TOFU-pin them with no
// client changes.
//
// Trust semantics: a platform signature attests "the registry vouches these
// bytes are what it mirrored" — the same trust level session-attested uploads
// already get. `external_author: true` still marks provenance in manifests.
// Author-signed and session-attested rows are never touched.
//
// Sqlite dual-path bodies were removed in U5. Residual callers get fail-closed
// stubs; characterization uses tests/legacy-sqlite-platform-signing.ts.
// MySQL uses *Prisma.

import { createPrivateKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import type { DatabaseSync } from '../db/sqlite-handle.js'
import { BUNDLE_SIG_TYP, bundleSignatureBytes } from '@skillet/protocol'
import type { PrismaDb } from '../db/prisma-client.js'
import { versionOrdinalPrisma } from './version-ordinal.js'

export interface PlatformKey {
  /** 64-char hex — hex(raw pub), the same key_id↔pub binding author keys use. */
  keyId: string
  /** base64 raw 32-byte Ed25519 pub — the `users.author_public_key` encoding. */
  publicKeyB64: string
  privateKey: KeyObject
}

const PURPOSE = 'attestation'
const SQLITE_REMOVED = 'sqlite registry store removed; use the *Prisma counterpart'

/** Fail-closed stand-in; characterization uses tests/legacy-sqlite-platform-signing.ts. */
export function platformAttestationKey(_db: DatabaseSync): PlatformKey {
  throw new Error(`${SQLITE_REMOVED}: platformAttestationKeyPrisma`)
}

/**
 * Fail-closed stand-in; characterization uses tests/legacy-sqlite-platform-signing.ts.
 */
export function attestVersionRowIfUnsigned(
  _db: DatabaseSync,
  _opts: { skillId: string; hash: string; ref: string },
): boolean {
  throw new Error(`${SQLITE_REMOVED}: attestVersionRowIfUnsignedPrisma`)
}

/** Load (or mint once and persist) the platform attestation keypair via Prisma. */
export async function platformAttestationKeyPrisma(prisma: PrismaDb): Promise<PlatformKey> {
  const row = await prisma.platform_keys.findUnique({
    where: { purpose: PURPOSE },
    select: { key_id: true, public_key: true, secret_pem: true },
  })
  if (row) {
    return {
      keyId: row.key_id,
      publicKeyB64: row.public_key,
      privateKey: createPrivateKey(row.secret_pem),
    }
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string }
  const raw = Buffer.from(jwk.x, 'base64url')
  const key: PlatformKey = {
    keyId: raw.toString('hex'),
    publicKeyB64: raw.toString('base64'),
    privateKey,
  }
  await prisma.platform_keys.createMany({
    data: [
      {
        purpose: PURPOSE,
        key_id: key.keyId,
        public_key: key.publicKeyB64,
        secret_pem: privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
      },
    ],
    skipDuplicates: true,
  })
  // A concurrent mint may have won; re-read so we sign with the persisted key.
  const persisted = await prisma.platform_keys.findUnique({
    where: { purpose: PURPOSE },
    select: { key_id: true, public_key: true, secret_pem: true },
  })
  if (!persisted) return key
  return {
    keyId: persisted.key_id,
    publicKeyB64: persisted.public_key,
    privateKey: createPrivateKey(persisted.secret_pem),
  }
}

/** Prisma async counterpart of {@link attestVersionRowIfUnsigned}. */
export async function attestVersionRowIfUnsignedPrisma(
  prisma: PrismaDb,
  opts: { skillId: string; hash: string; ref: string },
): Promise<boolean> {
  const unsigned = await prisma.skill_versions.findFirst({
    where: {
      skill_id: opts.skillId,
      hash: opts.hash,
      signature_alg: null,
    },
    select: { hash: true },
  })
  if (!unsigned) return false
  const key = await platformAttestationKeyPrisma(prisma)
  const version = await versionOrdinalPrisma(prisma, opts.skillId, opts.hash)
  const contentHash = opts.hash.startsWith('sha256:') ? opts.hash : `sha256:${opts.hash}`
  const bytes = bundleSignatureBytes({
    typ: BUNDLE_SIG_TYP,
    author_key_id: key.keyId,
    ref: opts.ref,
    version,
    content_hash: contentHash,
  })
  const sig = sign(null, bytes, key.privateKey)
  const updated = await prisma.skill_versions.updateMany({
    where: {
      skill_id: opts.skillId,
      hash: opts.hash,
      signature_alg: null,
    },
    data: {
      signature_alg: 'ed25519',
      signature_key_id: key.keyId,
      signature_b64: sig.toString('base64'),
      author_key_id: key.keyId,
      sig_version: 2,
    },
  })
  return updated.count > 0
}

/**
 * Fail-closed stand-in; characterization uses tests/legacy-sqlite-platform-signing.ts.
 * Server boot on the legacy sqlite path loads the quarantine helper dynamically.
 */
export function backfillUnsignedVersions(_db: DatabaseSync): number {
  throw new Error(`${SQLITE_REMOVED}: backfillUnsignedVersions (legacy characterization only)`)
}
