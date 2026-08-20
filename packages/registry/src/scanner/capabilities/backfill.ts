// Capability manifest backfill / rescan job.
//
// ⚠️  STANDALONE BACKGROUND JOB — NEVER in the deploy / migration critical path.
// Do NOT call this from a migration, server startup, or any request handler. It
// loads bundle bytes from blob storage and runs the capability detectors over
// the WHOLE existing catalog, so it must run as a separate, throttled job that
// can drain over time (batched, bounded concurrency, optional inter-batch sleep).
//
// Bumping CAPABILITY_VERSION alone is ALREADY safe without this job: existing
// `capabilities_json` rows refresh LAZILY (a version's next rescan is a
// capability-cache miss at the new version → recompute) and the public ETag
// busts on the new payload. This backfill only ACCELERATES visibility — it fills
// rows that predate the manifest feature (NULL) and refreshes rows stamped under
// an older CAPABILITY_VERSION across the catalog, instead of waiting for each
// version to be rescanned. It is idempotent and resumable: a row already at the
// current version is never re-selected, so re-running is safe and cheap.
//
// CACHE INTERACTION: this job does NOT warm `capability_result_cache`. It
// writes the per-version `skill_version_scans.capabilities_json` directly; the
// content-keyed result cache fills LAZILY on the next regular scan of matching
// content. Two follow-ons: (a) the first regular re-scan after a backfill still
// recomputes once (a cache miss) before the cache serves it; (b) after a
// CAPABILITY_VERSION bump the old-version cache rows become unreachable but are
// NOT deleted — they accumulate. Reclaim them out-of-band with a periodic
// `DELETE FROM capability_result_cache WHERE capability_version < <current>;`
// followed by a `VACUUM;` (never inline in this job or any request path).

import type { DatabaseSync } from '../../db/sqlite-handle.js'
import type { DecodedBundle } from '@skillet/protocol'
import { loadBundleFromManifest } from '../../blob-store/load-bundle.js'
import type { BlobStore } from '../../blob-store/types.js'
import { threatFindingsFromJson } from '../runner.js'
import { CAPABILITY_VERSION, computeCapabilities } from './scan.js'

type BindValue = null | number | bigint | string | Uint8Array

function sqliteRows<T>(db: DatabaseSync, sql: string, ...params: BindValue[]): T[] {
  return db.prepare(sql).all(...params) as unknown as T[]
}

function sqliteRow<T>(db: DatabaseSync, sql: string, ...params: BindValue[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined
}

/** Reconstruct a version bundle via sqlite manifest rows + blob store (CLI characterization). */
async function loadBundleForVersionSqlite(
  db: DatabaseSync,
  blobStore: BlobStore,
  versionHash: string,
): Promise<DecodedBundle | null> {
  const bare = versionHash.startsWith('sha256:')
    ? versionHash.slice('sha256:'.length)
    : versionHash
  const prefixed = `sha256:${bare}`
  const hashes = bare === versionHash ? [versionHash, prefixed] : [versionHash, bare]
  const placeholders = hashes.map(() => '?').join(',')
  const rows = sqliteRows<{ path: string; blob_hash: string }>(
    db,
    `SELECT path, blob_hash FROM skill_version_files
       WHERE version_hash IN (${placeholders})
       ORDER BY path`,
    ...hashes,
  )
  if (rows.length === 0) return null
  return loadBundleFromManifest(blobStore, rows)
}

/** Stamp capabilities_json + version on a scan row (sqlite CLI path only). */
function persistVersionCapabilitiesSqlite(
  db: DatabaseSync,
  skillId: string,
  versionHash: string,
  capabilitiesJson: string | null,
): void {
  if (capabilitiesJson == null) return
  db.prepare(
    `UPDATE skill_version_scans
        SET capabilities_json = ?, capabilities_version = ?
      WHERE skill_id = ? AND skill_version_id = ?`,
  ).run(capabilitiesJson, CAPABILITY_VERSION, skillId, versionHash)
}

export interface BackfillCapabilitiesOptions {
  /** Blob store the version bundles are reconstructed from. */
  blobStore: BlobStore;
  /** Recompute EVERY row regardless of its stored capabilities_version. */
  all?: boolean;
  /** Compute + classify but write nothing. */
  dryRun?: boolean;
  /** Cap the total number of rows processed across all batches. */
  limit?: number;
  /** Rows selected (and processed) per batch. Never loads all rows at once. */
  batch?: number;
  /** Max bundles loaded/computed concurrently within a batch. */
  concurrency?: number;
  /** Pause between batches so the job can drain without hammering blob storage. */
  sleepMs?: number;
  /** Progress sink. Defaults to a no-op (the CLI wires it to console.log). */
  log?: (msg: string) => void;
}

export interface BackfillCapabilitiesResult {
  /** Rows matching the target predicate at the start (for progress display). */
  targeted: number;
  /** Rows actually visited this run. */
  processed: number;
  /** Rows that had no computed manifest (NULL) and now do. */
  filled: number;
  /** Rows that had an older-version manifest and were recomputed. */
  refreshed: number;
  /**
   * Rows left untouched: the bundle couldn't be loaded OR the capability scan
   * returned not-computed (null). NEVER written as a false empty report.
   */
  skippedUnavailable: number;
  /**
   * Rows whose per-row processing THREW (a compute/serialize error, or a persist
   * write failure such as a lingering SQLITE_BUSY). Counted and drained past, NOT
   * fatal: one deterministically-throwing row must not abort the whole run or
   * halt every rerun at the same cursor.
   */
  skippedError: number;
}

interface TargetRow {
  skill_id: string;
  skill_version_id: string;
  findings_json: string;
  capabilities_json: string | null;
  capabilities_version: number | null;
}

const DEFAULT_BATCH = 100;
const DEFAULT_CONCURRENCY = 5;

/** Count rows matching the target predicate (one query, for the progress total). */
function countTargets(db: DatabaseSync, all: boolean): number {
  const row = all
    ? sqliteRow<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM skill_version_scans')
    : sqliteRow<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM skill_version_scans
          WHERE capabilities_json IS NULL
             OR capabilities_version IS NULL
             OR capabilities_version < ?`,
        CAPABILITY_VERSION,
      );
  return row?.n ?? 0;
}

/**
 * One batch of targets past `cursor`, keyset-paginated by skill_version_id.
 *
 * Keyset (not OFFSET) so a run advances PAST un-loadable rows instead of
 * re-selecting them forever: a skipped row keeps matching the predicate, but the
 * cursor has already moved beyond it, so it isn't revisited this run. (A later
 * run targets it again — by design; the bundle may have been restored.)
 */
function selectTargetBatch(
  db: DatabaseSync,
  all: boolean,
  cursor: string,
  take: number,
): TargetRow[] {
  if (all) {
    return sqliteRows<TargetRow>(
      db,
      `SELECT skill_id, skill_version_id, findings_json, capabilities_json, capabilities_version
         FROM skill_version_scans
        WHERE skill_version_id > ?
        ORDER BY skill_version_id
        LIMIT ?`,
      cursor,
      take,
    );
  }
  return sqliteRows<TargetRow>(
    db,
    `SELECT skill_id, skill_version_id, findings_json, capabilities_json, capabilities_version
       FROM skill_version_scans
      WHERE skill_version_id > ?
        AND (capabilities_json IS NULL
             OR capabilities_version IS NULL
             OR capabilities_version < ?)
      ORDER BY skill_version_id
      LIMIT ?`,
    cursor,
    CAPABILITY_VERSION,
    take,
  );
}

type RowOutcome = 'filled' | 'refreshed' | 'skipped-unavailable' | 'skipped-error';

/**
 * Recompute + persist one version's capability manifest. Reads the stored threat
 * findings (no threat rescan), loads the bundle, computes, and persists through
 * the capabilities-only path (null → leave row untouched, never write []).
 *
 * FULLY isolated: the ENTIRE body — including the persist write — runs
 * under one try/catch. A persist throw (e.g. a SQLITE_BUSY that outlasts the
 * busy_timeout) or any other per-row failure is classified as `skipped-error`
 * and the run keeps draining; it never rejects the worker, aborts `Promise.all`,
 * corrupts counts, or deterministically halts every rerun at the same cursor.
 */
async function processRow(
  db: DatabaseSync,
  blobStore: BlobStore,
  row: TargetRow,
  dryRun: boolean,
): Promise<RowOutcome> {
  try {
    const wasComputed = row.capabilities_json != null && row.capabilities_version != null;
    let bundle: DecodedBundle | null;
    try {
      bundle = await loadBundleForVersionSqlite(db, blobStore, row.skill_version_id);
    } catch {
      // A blob-store read error is treated identically to a missing bundle: the
      // row is left exactly as-is, never written as a false empty.
      return 'skipped-unavailable';
    }
    if (!bundle) return 'skipped-unavailable';

    const threatFindings = threatFindingsFromJson(row.findings_json);
    const report = computeCapabilities(bundle, threatFindings);
    // null = not computed (a transient detector failure). Leave the row untouched.
    if (report == null) return 'skipped-unavailable';

    if (!dryRun) persistVersionCapabilitiesSqlite(db, row.skill_id, row.skill_version_id, JSON.stringify(report));
    return wasComputed ? 'refreshed' : 'filled';
  } catch {
    // Compute/serialize/persist failure → counted skip, keep draining.
    return 'skipped-error';
  }
}

/** Run `fn` over `items` with at most `concurrency` in flight at once. */
async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Clamp an optional knob to a positive integer, falling back when absent/invalid. */
function clampPositive(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

/**
 * Backfill / rescan capability manifests across the catalog.
 *
 * Targets rows where capabilities were never computed (NULL) or were computed
 * under an older CAPABILITY_VERSION; `--all` recomputes every row. Idempotent +
 * resumable (current-version rows are never selected), throttled (batched,
 * bounded concurrency, optional inter-batch sleep), and memory-bounded (one
 * batch resident at a time — never SELECTs the whole table).
 */
export async function backfillCapabilities(
  db: DatabaseSync,
  opts: BackfillCapabilitiesOptions,
): Promise<BackfillCapabilitiesResult> {
  const { blobStore, all = false, dryRun = false, limit, sleepMs = 0, log = () => {} } = opts;
  // Clamp to >=1: `batch`/`concurrency` of 0 or negative would otherwise
  // make the loop process nothing (remaining <= 0 → immediate break) or spin no
  // workers. `?? DEFAULT` only fills `undefined`, so an explicit 0 must be clamped.
  const batch = clampPositive(opts.batch, DEFAULT_BATCH);
  const concurrency = clampPositive(opts.concurrency, DEFAULT_CONCURRENCY);

  const targeted = countTargets(db, all);
  const result: BackfillCapabilitiesResult = {
    targeted,
    processed: 0,
    filled: 0,
    refreshed: 0,
    skippedUnavailable: 0,
    skippedError: 0,
  };

  let cursor = '';
  while (limit == null || result.processed < limit) {
    const remaining = limit == null ? batch : Math.min(batch, limit - result.processed);
    if (remaining <= 0) break;
    const rows = selectTargetBatch(db, all, cursor, remaining);
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].skill_version_id;

    await mapWithConcurrency(rows, concurrency, async (row) => {
      const outcome = await processRow(db, blobStore, row, dryRun);
      // Single-threaded: these counter updates run synchronously between awaits.
      result.processed += 1;
      if (outcome === 'filled') result.filled += 1;
      else if (outcome === 'refreshed') result.refreshed += 1;
      else if (outcome === 'skipped-error') result.skippedError += 1;
      else result.skippedUnavailable += 1;
    });

    log(
      `${result.processed}/${targeted} (filled ${result.filled}, refreshed ${result.refreshed}, skipped-unavailable ${result.skippedUnavailable}, skipped-error ${result.skippedError})`,
    );

    if (sleepMs > 0) await sleep(sleepMs);
  }

  return result;
}

// ---------------------------------------------------------------------------
// CLI entry — run as a separate, throttled background job (see header):
//
//   REGISTRY_DB_PATH=/data/registry.db \
//     pnpm --filter @skillet/registry backfill:capabilities -- --dry-run
//   REGISTRY_DB_PATH=/data/registry.db \
//     pnpm --filter @skillet/registry backfill:capabilities -- --batch=200 --concurrency=8 --sleep-ms=500
//   ... --all   # force-recompute every row regardless of stored version
// ---------------------------------------------------------------------------

export async function runBackfillCapabilitiesCli(argv: string[]): Promise<number> {
  // The SQLite CLI was retired in the MySQL cutover; the capability-only backfill
  // is superseded by the two-lane Prisma backfill (threat + capability in one
  // walk). Delegate so `backfill:capabilities` keeps working as an alias.
  const { runBackfillScansCli } = await import('../backfill-scans-cli.js')
  return runBackfillScansCli(argv)
}

const invokedDirectly =
  process.argv[1]?.endsWith('backfill.js') || process.argv[1]?.endsWith('backfill.ts');

if (invokedDirectly) {
  runBackfillCapabilitiesCli(process.argv)
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
