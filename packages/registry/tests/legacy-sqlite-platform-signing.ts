// Quarantined sqlite platform-signing helpers for characterization under tests/ (U5).
import { createPrivateKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import { BUNDLE_SIG_TYP, bundleSignatureBytes } from '@skillet/protocol'
import { query, queryOne } from './legacy-sqlite-query.js'
import { versionOrdinal } from './legacy-sqlite-version-ordinal.js'
import type { PlatformKey } from '../src/lib/platform-signing.js'

export type { PlatformKey }

const PURPOSE = 'attestation'

let cached: { db: DatabaseSync; key: PlatformKey } | null = null

/** Load (or mint once and persist) the platform attestation keypair. */
export function platformAttestationKey(db: DatabaseSync): PlatformKey {
  if (cached?.db === db) return cached.key
  const row = queryOne<{ key_id: string; public_key: string; secret_pem: string }>(
    db,
    'SELECT key_id, public_key, secret_pem FROM platform_keys WHERE purpose = ?',
    PURPOSE,
  )
  let key: PlatformKey
  if (row) {
    key = {
      keyId: row.key_id,
      publicKeyB64: row.public_key,
      privateKey: createPrivateKey(row.secret_pem),
    }
  } else {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string }
    const raw = Buffer.from(jwk.x, 'base64url')
    key = {
      keyId: raw.toString('hex'),
      publicKeyB64: raw.toString('base64'),
      privateKey,
    }
    db.prepare(
      'INSERT INTO platform_keys (purpose, key_id, public_key, secret_pem) VALUES (?, ?, ?, ?)',
    ).run(
      PURPOSE,
      key.keyId,
      key.publicKeyB64,
      privateKey.export({ format: 'pem', type: 'pkcs8' }) as string,
    )
  }
  cached = { db, key }
  return key
}

/**
 * Sign one version row with the platform key iff it carries no signature at
 * all. Author-signed (`ed25519`) and session-attested (`session`) rows are
 * left untouched. Returns true when a signature was written.
 */
export function attestVersionRowIfUnsigned(
  db: DatabaseSync,
  opts: { skillId: string; hash: string; ref: string },
): boolean {
  const unsigned = queryOne<{ hash: string }>(
    db,
    'SELECT hash FROM skill_versions WHERE skill_id = ? AND hash = ? AND signature_alg IS NULL',
    opts.skillId,
    opts.hash,
  )
  if (!unsigned) return false
  const key = platformAttestationKey(db)
  const version = versionOrdinal(db, opts.skillId, opts.hash)
  const contentHash = opts.hash.startsWith('sha256:') ? opts.hash : `sha256:${opts.hash}`
  const bytes = bundleSignatureBytes({
    typ: BUNDLE_SIG_TYP,
    author_key_id: key.keyId,
    ref: opts.ref,
    version,
    content_hash: contentHash,
  })
  const sig = sign(null, bytes, key.privateKey)
  db.prepare(
    `UPDATE skill_versions
        SET signature_alg = 'ed25519', signature_key_id = ?, signature_b64 = ?,
            author_key_id = ?, sig_version = 2
      WHERE skill_id = ? AND hash = ? AND signature_alg IS NULL`,
  ).run(key.keyId, sig.toString('base64'), key.keyId, opts.skillId, opts.hash)
  return true
}

/**
 * Sign every version that has no signature at all (mirrors and seeds
 * published before attestation existed). Idempotent and pure DB work.
 */
export function backfillUnsignedVersions(db: DatabaseSync): number {
  const rows = query<{ hash: string; skill_id: string; author_id: string; slug: string }>(
    db,
    `SELECT v.hash, v.skill_id, s.author_id, s.slug
       FROM skill_versions v
       JOIN skills s ON s.id = v.skill_id
      WHERE v.signature_alg IS NULL`,
  )
  let signed = 0
  for (const row of rows) {
    if (
      attestVersionRowIfUnsigned(db, {
        skillId: row.skill_id,
        hash: row.hash,
        ref: `@${row.author_id}/${row.slug}`,
      })
    ) {
      signed += 1
    }
  }
  return signed
}

// Re-export KeyObject typing for callers that need it.
export type { KeyObject }
