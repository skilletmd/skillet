// Shared blobs-table metadata writes for BlobStore backends (U3).
// Bytes live in memory/R2; relational rows stay joinable for skill_version_files.
//
// Sqlite dual-path bodies were removed in U5.
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaDb } from '../db/prisma-client.js'

const SQLITE_REMOVED = 'sqlite registry store removed; use the *Prisma counterpart'

/** Fail-closed stand-in; MySQL uses {@link putBlobMetaPrisma}. */
export function putBlobMetaSqlite(
  _db: DatabaseSync,
  _hash: string,
  _size: number,
  _storageLoc: 'memory' | 'r2' | 'inline',
): void {
  throw new Error(`${SQLITE_REMOVED}: putBlobMetaPrisma`)
}

/** Write a blobs metadata row via Prisma/MySQL. Empty bytes column; content is external. */
export async function putBlobMetaPrisma(
  prisma: PrismaDb,
  hash: string,
  size: number,
  storageLoc: 'memory' | 'r2' | 'inline',
): Promise<void> {
  await prisma.blobs.createMany({
    data: [
      {
        hash,
        size,
        storage_loc: storageLoc,
      },
    ],
    skipDuplicates: true,
  })
}

/**
 * Persist a blob's actual BYTES inline (storage_loc='inline') via Prisma. Upsert
 * so a prior metadata-only row (empty bytes, storage_loc='memory') is backfilled
 * rather than skipped. Used by MemoryBlobStore in dev so file content survives a
 * registry restart (the in-memory Map does not). Prod uses R2, never this.
 */
export async function putBlobBytesPrisma(
  prisma: PrismaDb,
  hash: string,
  bytes: Uint8Array,
): Promise<void> {
  const buf = Buffer.from(bytes)
  await prisma.blobs.upsert({
    where: { hash },
    create: { hash, size: bytes.byteLength, storage_loc: 'inline', bytes: buf },
    update: { size: bytes.byteLength, storage_loc: 'inline', bytes: buf },
  })
}

/** True when a blobs row exists for hash (Prisma). */
export async function hasBlobMetaPrisma(prisma: PrismaDb, hash: string): Promise<boolean> {
  const row = await prisma.blobs.findUnique({
    where: { hash },
    select: { hash: true },
  })
  return row != null
}

/**
 * Read a blob's INLINE bytes (storage_loc='inline') from the blobs table.
 * Returns null for a metadata-only row (bytes empty, e.g. storage_loc='memory')
 * or a missing hash. Tries both hash forms (bare / sha256:-prefixed) so seeded
 * rows written under either convention still resolve.
 */
export async function readBlobBytesPrisma(
  prisma: PrismaDb,
  hash: string,
): Promise<Uint8Array | null> {
  const bare = hash.replace(/^sha256:/, '')
  const row = await prisma.blobs.findFirst({
    where: { hash: { in: [hash, bare, `sha256:${bare}`] } },
    select: { bytes: true },
  })
  return row?.bytes && row.bytes.length > 0 ? new Uint8Array(row.bytes) : null
}
