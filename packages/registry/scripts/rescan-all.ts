/**
 * Re-scan every public skill's latest version against the current detector
 * corpus and persist the new status. Use after a scanner change (a
 * DETECTOR_CORPUS_VERSION bump makes the cache miss, so each skill is scanned
 * fresh, not served a stale cached result).
 *
 *   cd packages/registry
 *   REGISTRY_DB_PATH=./registry.db npx tsx scripts/rescan-all.ts
 *   ... --dry-run   # report the status delta, write nothing
 *
 * Prints a before/after status breakdown so the effect of the scanner change is
 * visible. Read-mostly: only skill_version_scans rows change.
 */
import { pathToFileURL } from 'node:url';
import { query } from '../tests/legacy-sqlite-query.js';
import { SqliteBlobStore } from '../tests/legacy-sqlite-blob-store.js'
import { runScanForVersion } from '../src/scanner/runner.js';
import { throwSqliteCliRetired } from '../src/db/cli-store-retired.js'

interface SkillRow {
  id: string;
  latest_hash: string;
  status: string | null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  throwSqliteCliRetired('rescan-all')
}


const invokedDirectly =
  process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) void main();
