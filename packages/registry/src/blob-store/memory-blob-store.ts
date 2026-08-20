import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaDb } from '../db/prisma-client.js'
import type { BlobStore } from './types.js'
import { hasBlobMetaPrisma, putBlobBytesPrisma, readBlobBytesPrisma } from './blob-meta.js'

/**
 * Process-local BlobStore for tests/dev. Bytes stay in memory for the life of the
 * process; when Prisma is provided we ALSO persist the bytes inline in the blobs
 * table so file content survives a registry restart (a `tsx watch` reload wipes
 * the in-memory Map — otherwise the file viewer 404s for everything published
 * before the last restart). `get` reads the Map first, then falls back to the
 * persisted inline bytes. Prod runs the R2 store, never this.
 *
 * Sqlite dual-path meta/read legs were removed in U5.
 */
export class MemoryBlobStore implements BlobStore {
  private readonly map = new Map<string, Uint8Array>()

  constructor(
    private readonly _db?: DatabaseSync,
    private readonly prisma?: PrismaDb,
  ) {}

  async get(hash: string): Promise<Uint8Array | null> {
    const cached = this.map.get(hash)
    if (cached) return new Uint8Array(cached)
    // Fall back to INLINE bytes persisted in the blobs table — seeded/mirror
    // content (and any storage_loc='inline' row) that this process never put()
    // into its in-memory map. Metadata-only rows (empty bytes) resolve to null,
    // matching prior behavior. Prod runs the R2 store, so this leg is dev/seed.
    if (this.prisma) return readBlobBytesPrisma(this.prisma, hash)
    return null
  }

  async put(hash: string, bytes: Uint8Array): Promise<void> {
    this.map.set(hash, new Uint8Array(bytes))
    if (this.prisma) {
      // Persist the bytes inline (not just metadata) so they survive a restart.
      await putBlobBytesPrisma(this.prisma, hash, bytes)
    }
  }

  async has(hash: string): Promise<boolean> {
    if (this.map.has(hash)) return true
    if (this.prisma) return hasBlobMetaPrisma(this.prisma, hash)
    return false
  }

  clear(): void {
    this.map.clear()
  }
}
