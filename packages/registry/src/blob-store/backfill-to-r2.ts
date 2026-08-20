import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { BlobStore } from './types.js'

type BindValue = null | number | bigint | string | Uint8Array

function sqliteRows<T>(db: DatabaseSync, sql: string, ...params: BindValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[]
}

function sqliteRow<T>(db: DatabaseSync, sql: string, ...params: BindValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

export interface BackfillToR2Options {
  /** Log uploads but do not write to R2. */
  dryRun?: boolean;
  /** When true, only report status; never upload. */
  verifyOnly?: boolean;
  /**
   * When false (default), only hashes referenced by `skill_version_files`.
   * When true, every inline row in `blobs` with non-empty bytes.
   */
  allBlobs?: boolean;
  /** Optional subset; defaults to referenced (or all inline when `allBlobs`). */
  hashes?: string[];
}

export interface BackfillToR2Result {
  uploaded: string[];
  skipped: string[];
  missing: string[];
  failed: Array<{ hash: string; error: string }>;
}

/** Distinct blob hashes still referenced by at least one skill version manifest. */
export function referencedBlobHashes(db: DatabaseSync): string[] {
  const rows = sqliteRows<{ hash: string }>(
    db,
    'SELECT DISTINCT blob_hash AS hash FROM skill_version_files ORDER BY blob_hash',
  );
  return rows.map((r) => r.hash);
}

/** Inline blob rows with real bytes (legacy sqlite storage). */
export function inlineBlobHashes(db: DatabaseSync): string[] {
  const rows = sqliteRows<{ hash: string }>(
    db,
    `SELECT hash FROM blobs
       WHERE size > 0 AND length(bytes) > 0
       ORDER BY hash`,
  );
  return rows.map((r) => r.hash);
}

function resolveTargetHashes(db: DatabaseSync, options: BackfillToR2Options): string[] {
  if (options.hashes?.length) return [...new Set(options.hashes)].sort();
  if (options.allBlobs) return inlineBlobHashes(db);
  return referencedBlobHashes(db);
}

/**
 * Copy inline SQLite blob bytes into R2 for hashes that R2 cannot serve yet.
 * We use `r2.get` (not `has`) because metadata rows can exist before the object lands.
 */
export async function backfillBlobsToR2(
  db: DatabaseSync,
  sqlite: BlobStore,
  r2: BlobStore,
  options: BackfillToR2Options = {},
): Promise<BackfillToR2Result> {
  const dryRun = options.dryRun === true;
  const verifyOnly = options.verifyOnly === true;
  const targets = resolveTargetHashes(db, options);

  const result: BackfillToR2Result = {
    uploaded: [],
    skipped: [],
    missing: [],
    failed: [],
  };

  for (const hash of targets) {
    try {
      const inR2 = await r2.get(hash);
      if (inR2 && inR2.byteLength > 0) {
        result.skipped.push(hash);
        continue;
      }

      const bytes = await sqlite.get(hash);
      if (!bytes || bytes.byteLength === 0) {
        result.missing.push(hash);
        continue;
      }

      if (verifyOnly) {
        result.missing.push(hash);
        continue;
      }

      if (!dryRun) {
        await r2.put(hash, bytes);
      }
      result.uploaded.push(hash);
    } catch (err: unknown) {
      result.failed.push({
        hash,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/** Summarize inline vs r2 metadata for ops dashboards. */
export function blobStorageSummary(db: DatabaseSync): {
  referenced: number;
  inlineWithBytes: number;
  r2MetadataOnly: number;
} {
  const referenced = referencedBlobHashes(db).length;
  const inlineWithBytes = inlineBlobHashes(db).length;
  const r2MetadataOnly = sqliteRow<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM blobs
         WHERE COALESCE(storage_loc, 'inline') = 'r2' AND length(bytes) = 0`,
  )!.n;
  return { referenced, inlineWithBytes, r2MetadataOnly };
}
