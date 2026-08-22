/**
 * CLI for the two-lane scan backfill (threat + capability). Run after a scanner
 * corpus-version bump to refresh already-published rows that sync won't touch
 * (sync only re-scans on content change). Reads bundle bytes from the durable
 * blob store; recomputes through the publish scan path.
 *
 *   cd packages/registry
 *   npx tsx --env-file-if-exists=.env src/scanner/backfill-scans-cli.ts [--dry-run]
 *   ... --batch=200 --concurrency=8 --sleep-ms=500 --limit=1000
 *   ... --all    # recompute every row regardless of stored version
 *
 * The last stdout line is a JSON summary (the monitoring hook). Exit code is 0
 * unless a real error occurred (skipped-error); a missing bundle
 * (skipped-unavailable) is an expected state and does not fail the run.
 */
import { pathToFileURL } from 'node:url';
import { createPrismaClient } from '../db/prisma-client.js';
import { createPrismaBlobStore } from '../blob-store/create-blob-store.js';
import { backfillScansPrisma } from './backfill-scans.js';

function numFlag(argv: string[], name: string): number | undefined {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) {
    const n = Number(eq.slice(name.length + 1));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export async function runBackfillScansCli(argv: string[]): Promise<number> {
  const all = argv.includes('--all');
  const dryRun = argv.includes('--dry-run');
  const opts = {
    all,
    dryRun,
    ...(numFlag(argv, '--batch') != null ? { batch: numFlag(argv, '--batch') } : {}),
    ...(numFlag(argv, '--concurrency') != null ? { concurrency: numFlag(argv, '--concurrency') } : {}),
    ...(numFlag(argv, '--sleep-ms') != null ? { sleepMs: numFlag(argv, '--sleep-ms') } : {}),
    ...(numFlag(argv, '--limit') != null ? { limit: numFlag(argv, '--limit') } : {}),
  };
  const prisma = createPrismaClient();
  const blobStore = createPrismaBlobStore(prisma);
  try {
    const result = await backfillScansPrisma(prisma, {
      blobStore,
      ...opts,
      log: (m) => console.error(m),
    });
    console.log(JSON.stringify({ mode: all ? 'all' : 'stale', dryRun, ...result }));
    // Exit non-zero only on real errors. A missing bundle (skipped-unavailable)
    // is a routine, expected state for old/GC'd versions and must not read as a
    // job failure to CI/cron — the count is in the JSON summary for monitoring.
    return result.skippedError > 0 ? 1 : 0;
  }
  finally {
    await prisma.$disconnect();
  }
}

const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void runBackfillScansCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
