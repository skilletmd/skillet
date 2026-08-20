import type { DatabaseSync } from '../db/sqlite-handle.js'
import { unavailableSqliteHandle } from '../db/sqlite-handle.js'
import type { PrismaDb } from '../db/prisma-client.js'
import { FallbackBlobStore } from './fallback-blob-store.js'
import { MemoryBlobStore } from './memory-blob-store.js'
import { R2BlobStore } from './r2-blob-store.js'
import type { BlobStore, BlobStoreMode } from './types.js'

const R2_ENV_KEYS = [
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET',
] as const

/** True when every R2 credential env var is non-empty. */
function hasR2Env(): boolean {
  return R2_ENV_KEYS.every((name) => Boolean(process.env[name]?.trim()))
}

/**
 * Resolve blob backend from `BLOB_STORE`.
 * When unset: prefer `r2` if R2 credentials are present; otherwise `memory`.
 * `BLOB_STORE=sqlite` is rejected after the MySQL cutover.
 */
export function resolveBlobStoreMode(raw: string | undefined = process.env.BLOB_STORE): BlobStoreMode {
  if (raw === 'r2' || raw === 'dual' || raw === 'memory') return raw
  if (raw === 'sqlite') {
    throw new Error(
      'BLOB_STORE=sqlite was removed. Use BLOB_STORE=r2 (prod) or BLOB_STORE=memory (tests).',
    )
  }
  if (hasR2Env()) return 'r2'
  return 'memory'
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`Missing required env var ${name} for R2 blob storage`)
  return value
}

export function createBlobStore(db: DatabaseSync, prisma?: PrismaDb): BlobStore {
  const mode = resolveBlobStoreMode(process.env.BLOB_STORE)

  // When Prisma is primary we do not keep a live sqlite handle for blob bytes.
  const sqliteDb = prisma ? undefined : db

  if (mode === 'memory') return new MemoryBlobStore(sqliteDb, prisma)

  const r2 = new R2BlobStore(
    db,
    {
      accountId: requireEnv('R2_ACCOUNT_ID'),
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
      bucket: requireEnv('R2_BUCKET'),
      keyPrefix: process.env.R2_KEY_PREFIX?.trim() || undefined,
    },
    undefined,
    prisma,
  )

  if (mode === 'r2') return r2

  // dual: write R2 + memory metadata path (no sqlite inline bytes)
  return new FallbackBlobStore(r2, new MemoryBlobStore(sqliteDb, prisma))
}

/** Prisma-primary callers (mirror CLI / nightly) with no live sqlite handle. */
export function createPrismaBlobStore(prisma: PrismaDb): BlobStore {
  return createBlobStore(unavailableSqliteHandle(), prisma)
}
