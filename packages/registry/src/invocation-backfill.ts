// Invocation-facts backfill job.
//
// ⚠️  STANDALONE BACKGROUND JOB — NEVER in the deploy / migration critical path.
// Re-parses each existing version's stored SKILL.md and merges the two
// invocation booleans (modelInvoked, hasCommand) into its metadata_json, so
// skills published before the flags existed report correct facts immediately
// instead of leaning on the serve-time default (model-invoked iff a description
// exists, never a command).
//
// Idempotent + resumable: a row already carrying both boolean keys is skipped
// (unless --all), and batches are keyset-paginated by hash so a run advances
// PAST un-loadable rows instead of re-selecting them forever. Memory-bounded:
// one batch resident at a time.

import type { DatabaseSync } from './db/sqlite-handle.js'
import type { BlobStore } from './blob-store/types.js'
import { deriveInvocationFacts } from './skill-frontmatter.js'

type BindValue = null | number | bigint | string | Uint8Array

/** Local SELECT helper so this CLI waiver keeps prepare sites without the deleted query facade. */
function sqliteRows<T>(db: DatabaseSync, sql: string, ...params: BindValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[]
}

export interface BackfillInvocationOptions {
  /** Blob store the SKILL.md bytes are read from. */
  blobStore: BlobStore;
  /** Recompute EVERY row regardless of whether it already has the keys. */
  all?: boolean;
  /** Compute but write nothing. */
  dryRun?: boolean;
  /** Cap the total number of rows processed across all batches. */
  limit?: number;
  /** Rows selected (and processed) per batch. Never loads all rows at once. */
  batch?: number;
  /** Pause between batches so the job can drain without hammering blob storage. */
  sleepMs?: number;
  /** Progress sink. Defaults to a no-op (the CLI wires it to console.log). */
  log?: (msg: string) => void;
}

export interface BackfillInvocationResult {
  /** Rows visited this run. */
  processed: number;
  /** Rows whose metadata_json was updated with the two booleans. */
  updated: number;
  /** Rows left untouched: SKILL.md blob missing or unreadable. */
  skippedUnavailable: number;
  /** Rows whose per-row processing threw (malformed metadata, write failure). */
  skippedError: number;
}

interface TargetRow {
  hash: string;
  metadata_json: string;
  skill_md_hash: string | null;
}

const DEFAULT_BATCH = 200;

/** Already-stamped iff metadata carries both boolean keys (idempotency check). */
function alreadyStamped(metadataJson: string): boolean {
  try {
    const meta = JSON.parse(metadataJson) as { modelInvoked?: unknown; hasCommand?: unknown };
    return typeof meta.modelInvoked === 'boolean' && typeof meta.hasCommand === 'boolean';
  } catch {
    return false;
  }
}

/** One batch of versions past `cursor`, keyset-paginated by hash. */
function selectBatch(db: DatabaseSync, cursor: string, take: number): TargetRow[] {
  return sqliteRows<TargetRow>(
    db,
    `SELECT sv.hash AS hash,
            sv.metadata_json AS metadata_json,
            svf.blob_hash AS skill_md_hash
       FROM skill_versions sv
       LEFT JOIN skill_version_files svf
         ON svf.version_hash = sv.hash AND svf.path = 'SKILL.md'
      WHERE sv.hash > ?
      ORDER BY sv.hash
      LIMIT ?`,
    cursor,
    take,
  );
}

type RowOutcome = 'updated' | 'skipped-unavailable' | 'skipped-error';

/**
 * Re-derive the two facts for one version and merge them into metadata_json.
 * Fully isolated: any per-row failure is classified `skipped-error` and the run
 * keeps draining — one bad row never aborts the job or halts every rerun.
 */
async function processRow(
  db: DatabaseSync,
  blobStore: BlobStore,
  row: TargetRow,
  dryRun: boolean,
): Promise<RowOutcome> {
  try {
    if (!row.skill_md_hash) return 'skipped-unavailable';
    let bytes: Uint8Array | null;
    try {
      bytes = await blobStore.get(row.skill_md_hash);
    } catch {
      return 'skipped-unavailable';
    }
    if (!bytes) return 'skipped-unavailable';

    const facts = deriveInvocationFacts(new Map([['SKILL.md', bytes]]));
    if (!dryRun) {
      const patch = JSON.stringify({
        modelInvoked: facts.modelInvoked,
        hasCommand: facts.hasCommand,
      });
      db.prepare(
        `UPDATE skill_versions
            SET metadata_json = json_patch(COALESCE(NULLIF(trim(metadata_json), ''), '{}'), json(?))
          WHERE hash = ?`,
      ).run(patch, row.hash);
    }
    return 'updated';
  } catch {
    return 'skipped-error';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampPositive(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

/**
 * Backfill invocation facts across the catalog. Skips rows already carrying both
 * booleans (unless `all`), so re-running is safe and cheap.
 */
export async function backfillInvocationFacts(
  db: DatabaseSync,
  opts: BackfillInvocationOptions,
): Promise<BackfillInvocationResult> {
  const { blobStore, all = false, dryRun = false, limit, sleepMs = 0, log = () => {} } = opts;
  const batch = clampPositive(opts.batch, DEFAULT_BATCH);

  const result: BackfillInvocationResult = {
    processed: 0,
    updated: 0,
    skippedUnavailable: 0,
    skippedError: 0,
  };

  let cursor = '';
  while (limit == null || result.processed < limit) {
    const remaining = limit == null ? batch : Math.min(batch, limit - result.processed);
    if (remaining <= 0) break;
    const rows = selectBatch(db, cursor, remaining);
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].hash;

    for (const row of rows) {
      result.processed += 1;
      // Idempotent skip — counts as processed but does no work.
      if (!all && alreadyStamped(row.metadata_json)) continue;
      const outcome = await processRow(db, blobStore, row, dryRun);
      if (outcome === 'updated') result.updated += 1;
      else if (outcome === 'skipped-error') result.skippedError += 1;
      else result.skippedUnavailable += 1;
    }

    log(
      `${result.processed} processed (updated ${result.updated}, skipped-unavailable ${result.skippedUnavailable}, skipped-error ${result.skippedError})`,
    );

    if (sleepMs > 0) await sleep(sleepMs);
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI entry — run as a separate, throttled background job:
//
//   REGISTRY_DB_PATH=/data/registry.db \
//     pnpm --filter @skillet/registry backfill:invocation -- --dry-run
//   REGISTRY_DB_PATH=/data/registry.db \
//     pnpm --filter @skillet/registry backfill:invocation -- --batch=500 --sleep-ms=250
//   ... --all   # force-recompute every row regardless of existing keys
// ---------------------------------------------------------------------------

export async function runBackfillInvocationCli(_argv: string[]): Promise<number> {
  const { throwSqliteCliRetired } = await import('./db/cli-store-retired.js')
  return throwSqliteCliRetired('skill invocation-facts backfill')
}

const invokedDirectly =
  process.argv[1]?.endsWith('invocation-backfill.js') ||
  process.argv[1]?.endsWith('invocation-backfill.ts');

if (invokedDirectly) {
  runBackfillInvocationCli(process.argv)
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
