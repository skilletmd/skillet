/**
 * Precision spot-check over the live registry's stored scan results — the
 * repeatable version of the mirror-corpus FP analysis. Reads `skill_version_scans`
 * for the latest version of every public skill and reports the flag rate plus a
 * per-detector breakdown so a scanner change can be measured against real content.
 *
 *   cd packages/registry
 *   REGISTRY_DB_PATH=./registry.db npx tsx scripts/scan-precision-report.ts
 *
 * Read-only. Commits nothing. This is an ops report, not a CI gate — the CI gate
 * is the curated benign near-miss corpus (src/scanner/benign-corpus.ts).
 */
import { query } from '../tests/legacy-sqlite-query.js';
import { throwSqliteCliRetired } from '../src/db/cli-store-retired.js'

interface Finding {
  category: string;
  confidence: string;
  why: string;
}

function extractFindings(raw: string): Finding[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed as Finding[];
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { findings?: unknown }).findings)) {
      return (parsed as { findings: Finding[] }).findings;
    }
  } catch {
    /* ignore */
  }
  return [];
}

function main(): void {
  throwSqliteCliRetired('scan precision report')
}


main();
