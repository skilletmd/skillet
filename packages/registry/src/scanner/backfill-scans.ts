// Two-lane scan backfill on Prisma/MySQL. Refreshes skill_version_scans rows
// whose stored threat (detector_corpus_version) or capability (capabilities_version)
// version is behind the current corpus, by re-running the SAME publish scan path
// (resolveScanCachedPrisma → persistVersionScanPrisma) over the version's bundle.
//
// Why this exists: sync re-scans only on content change, and a corpus-version bump
// leaves already-published rows stale forever otherwise. The retired SQLite
// capability-backfill (capabilities/backfill.ts) covered one lane; this covers both
// on MySQL and is the tool operators run after a scanner bump.
//
// Selection is version-gated by default; `all` force-recomputes every row. The
// walk is resumable (explicit keyset on the (skill_version_id, skill_id) PK order,
// so unrefreshable rows are passed rather than re-selected forever), throttled
// (bounded concurrency + optional inter-batch sleep), and memory-bounded (one batch
// resident at a time). A missing/unreadable bundle is a counted skip, never a write.
import type { Prisma } from '@prisma/client';
import type { PrismaDb } from '../db/prisma-client.js';
import type { BlobStore } from '../blob-store/types.js';
import { loadBundleForVersionPrisma } from '../blob-store/load-bundle.js';
import { resolveScanCachedPrisma } from './index.js';
import { persistVersionScanPrisma } from '../lib/skill-publish.js';
import { lastCleanHashPrisma } from '../lib/sync-manifest.js';
import { CAPABILITY_VERSION } from './capabilities/scan.js';
import { DETECTOR_CORPUS_VERSION } from './cache.js';

export const DEFAULT_BATCH = 100;
export const DEFAULT_CONCURRENCY = 5;

export type RowOutcome = 'refreshed' | 'skipped-unavailable' | 'skipped-error';

/** Cursor is the last-seen composite PK, in PK (skill_id, skill_version_id) order
 *  so the walk seeks the clustered index instead of filesorting on the unindexed
 *  trailing column. */
export interface ScanCursor {
  skill_id: string;
  skill_version_id: string;
}

/** A selected row: its PK plus the stored lane versions, so processRow can tell a
 *  full refresh (all stale lanes brought current) from a partial one. */
export interface TargetRow extends ScanCursor {
  capabilities_version: number | null;
  detector_corpus_version: number | null;
}

export interface BackfillScansOptions {
  blobStore: BlobStore;
  /** Recompute every row regardless of stored version. */
  all?: boolean;
  /** Compute + count outcomes without writing. */
  dryRun?: boolean;
  /** Stop after processing this many rows (staged runs). */
  limit?: number;
  batch?: number;
  concurrency?: number;
  sleepMs?: number;
  log?: (message: string) => void;
}

export interface BackfillScansResult {
  targeted: number;
  processed: number;
  refreshed: number;
  /** Skills whose `latest_hash` disagreed with the post-refresh scan status and
   *  was corrected. Non-zero means the backfill un-stuck (or newly gated) skills,
   *  not merely rewrote scan rows. */
  reconciled: number;
  skippedUnavailable: number;
  skippedError: number;
}

/** A row is stale when EITHER lane is behind current (NULL counts as behind). */
export function stalenessWhere(): Prisma.skill_version_scansWhereInput {
  return {
    OR: [
      { capabilities_version: null },
      { capabilities_version: { lt: CAPABILITY_VERSION } },
      { detector_corpus_version: null },
      { detector_corpus_version: { lt: DETECTOR_CORPUS_VERSION } },
    ],
  };
}

/** Explicit keyset predicate over the (skill_id, skill_version_id) PK order —
 *  matches the clustered index so each batch seeks instead of full-scanning, and
 *  is independent of Prisma's cursor feature so it holds even when the previous
 *  batch's last row was refreshed out of the staleness set. */
function afterCursor(cursor: ScanCursor | null): Prisma.skill_version_scansWhereInput {
  if (!cursor) return {};
  return {
    OR: [
      { skill_id: { gt: cursor.skill_id } },
      { skill_id: cursor.skill_id, skill_version_id: { gt: cursor.skill_version_id } },
    ],
  };
}

function selectionWhere(all: boolean, cursor: ScanCursor | null): Prisma.skill_version_scansWhereInput {
  const gate = all ? {} : stalenessWhere();
  return { AND: [gate, afterCursor(cursor)] };
}

export async function countTargetsPrisma(prisma: PrismaDb, all: boolean): Promise<number> {
  return prisma.skill_version_scans.count({ where: all ? {} : stalenessWhere() });
}

export async function selectTargetBatchPrisma(
  prisma: PrismaDb,
  all: boolean,
  cursor: ScanCursor | null,
  take: number,
): Promise<TargetRow[]> {
  return prisma.skill_version_scans.findMany({
    where: selectionWhere(all, cursor),
    orderBy: [{ skill_id: 'asc' }, { skill_version_id: 'asc' }],
    take,
    select: {
      skill_id: true,
      skill_version_id: true,
      capabilities_version: true,
      detector_corpus_version: true,
    },
  });
}

/** Recompute one row through the publish scan path. Never throws; a load failure
 *  or transient scan/persist error leaves the row untouched and is counted.
 *
 *  Persist always advances the threat lane (detector_corpus_version), but the
 *  capability lane only advances when the recompute produced a manifest —
 *  `resolveScanCachedPrisma` legitimately returns `capabilitiesJson: null` on a
 *  non-throwing capability failure, and persist leaves the capability columns
 *  untouched in that case. So a row that was stale on the capability lane and
 *  came back null is NOT fully refreshed: report it as `skipped-unavailable` so
 *  the count is honest and it isn't falsely claimed converged (it re-selects next
 *  run, cheaply, until the manifest computes). */
export async function processRowPrisma(
  prisma: PrismaDb,
  blobStore: BlobStore,
  row: TargetRow,
  dryRun: boolean,
): Promise<RowOutcome> {
  try {
    let bundle;
    try {
      bundle = await loadBundleForVersionPrisma(prisma, blobStore, row.skill_version_id);
    } catch {
      return 'skipped-unavailable';
    }
    if (!bundle) return 'skipped-unavailable';

    const resolved = await resolveScanCachedPrisma(prisma, bundle);
    if (!dryRun) {
      await persistVersionScanPrisma(
        prisma,
        row.skill_id,
        row.skill_version_id,
        resolved.result.status,
        resolved.findingsJson,
        resolved.capabilitiesJson,
      );
    }
    const capsWasStale =
      row.capabilities_version == null || row.capabilities_version < CAPABILITY_VERSION;
    const capsNowCurrent = resolved.capabilitiesJson != null || !capsWasStale;
    return capsNowCurrent ? 'refreshed' : 'skipped-unavailable';
  } catch {
    return 'skipped-error';
  }
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(concurrency, items.length)) },
    async () => {
      while (next < items.length) {
        await fn(items[next++]);
      }
    },
  );
  await Promise.all(workers);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function clampPositive(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value < 1) return fallback;
  return Math.floor(value);
}

/**
 * Backfill stale scan rows across the catalog. Idempotent and resumable: a fully
 * current catalog targets zero rows; unrefreshable rows are passed by the keyset
 * so the walk always drains.
 */
export async function backfillScansPrisma(
  prisma: PrismaDb,
  opts: BackfillScansOptions,
): Promise<BackfillScansResult> {
  const { blobStore, all = false, dryRun = false, limit, sleepMs = 0, log = () => {} } = opts;
  const batch = clampPositive(opts.batch, DEFAULT_BATCH);
  const concurrency = clampPositive(opts.concurrency, DEFAULT_CONCURRENCY);

  const targeted = await countTargetsPrisma(prisma, all);
  const result: BackfillScansResult = {
    targeted,
    processed: 0,
    refreshed: 0,
    reconciled: 0,
    skippedUnavailable: 0,
    skippedError: 0,
  };

  // Every skill the walk touched, so the reconcile pass below can ask whether the
  // refreshed status changed which hash is servable.
  const touched = new Set<string>();

  let cursor: ScanCursor | null = null;
  while (limit == null || result.processed < limit) {
    const remaining = limit == null ? batch : Math.min(batch, limit - result.processed);
    if (remaining <= 0) break;
    const rows = await selectTargetBatchPrisma(prisma, all, cursor, remaining);
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1];

    await mapWithConcurrency(rows, concurrency, async (row) => {
      const outcome = await processRowPrisma(prisma, blobStore, row, dryRun);
      touched.add(row.skill_id);
      result.processed += 1;
      if (outcome === 'refreshed') result.refreshed += 1;
      else if (outcome === 'skipped-unavailable') result.skippedUnavailable += 1;
      else result.skippedError += 1;
    });

    log(
      `${result.processed}/${targeted} (refreshed ${result.refreshed}, ` +
        `skipped-unavailable ${result.skippedUnavailable}, skipped-error ${result.skippedError})`,
    );

    if (sleepMs > 0) await sleep(sleepMs);
  }

  // Refreshing the scan row is only half the job. `skills.latest_hash` is the
  // servable pointer, and sync recomputes it only when CONTENT changes — so a
  // corpus improvement that clears a quarantine used to leave the skill exactly
  // as unservable as before, with a clean scan sitting right next to a NULL
  // latest_hash. K-Dense's paper-lookup did that: the detector fix cleared its
  // quarantine and the skill stayed uninstallable, viewer hidden, until the
  // pointer was written by hand. It runs in the other direction too — a bump
  // that newly quarantines the current version must retract the pointer, or the
  // registry keeps serving a version the scanner now rejects.
  if (!dryRun) {
    for (const skillId of touched) {
      try {
        const want = await lastCleanHashPrisma(prisma, skillId);
        const skill = await prisma.skills.findUnique({
          where: { id: skillId },
          select: { latest_hash: true },
        });
        if (skill == null || skill.latest_hash === want) continue;
        await prisma.skills.update({ where: { id: skillId }, data: { latest_hash: want } });
        result.reconciled += 1;
        log(`  reconciled ${skillId}: latest_hash ${skill.latest_hash ?? 'NULL'} -> ${want ?? 'NULL'}`);
      } catch {
        // One unreadable skill must not abandon the rest of the reconcile pass.
      }
    }
  }

  return result;
}
