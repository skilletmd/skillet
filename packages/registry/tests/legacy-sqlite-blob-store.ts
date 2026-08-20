import type { DatabaseSync } from '../src/db/sqlite-handle.js'
import type { BlobStore } from '../src/blob-store/types.js';
import { verifyBlobBytes } from '../src/blob-store/verify-bytes.js';
import { queryOne } from './legacy-sqlite-query.js';

/** Default dev/test store — bytes live in the `blobs` table. */
export class SqliteBlobStore implements BlobStore {
  constructor(private readonly db: DatabaseSync) {}

  async get(hash: string): Promise<Uint8Array | null> {
    const row = queryOne<{ bytes: Uint8Array | Buffer | null }>(
      this.db,
      'SELECT bytes FROM blobs WHERE hash = ?',
      hash,
    );
    if (!row?.bytes || row.bytes.byteLength === 0) return null;
    const bytes = new Uint8Array(row.bytes);
    if (!verifyBlobBytes(hash, bytes)) return null;
    return bytes;
  }

  async put(hash: string, bytes: Uint8Array): Promise<void> {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO blobs (hash, bytes, size, storage_loc)
         VALUES (?, ?, ?, 'inline')`,
      )
      .run(hash, Buffer.from(bytes), bytes.byteLength);
  }

  async has(hash: string): Promise<boolean> {
    const row = queryOne<{ ok: number }>(
      this.db,
      'SELECT 1 AS ok FROM blobs WHERE hash = ? AND size > 0',
      hash,
    );
    return !!row;
  }
}
