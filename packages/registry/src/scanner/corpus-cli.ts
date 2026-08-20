#!/usr/bin/env node
// CLI entry for corpus validation — run from repo root:
//   pnpm --filter @skillet/registry scan:corpus
//   pnpm --filter @skillet/registry scan:corpus -- --snapshot docs/reports/prod-corpus-snapshot.json
//   pnpm --filter @skillet/registry scan:export-snapshot -- --db /data/registry.db --out docs/reports/prod-corpus-snapshot.json

import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import {
  buildCorpusReportFromRepo,
  formatCorpusReportMarkdown,
} from './corpus-report.js';
import {
  exportProdSnapshotFile,
  loadProdSnapshotBenign,
} from './prod-snapshot.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../..');

function parseArgs(argv: string[]): {
  command: 'corpus' | 'export-snapshot';
  snapshot?: string;
  db?: string;
  out?: string;
} {
  const args = argv.slice(2);
  const command =
    args[0] === 'export-snapshot' || args[0] === 'scan:export-snapshot'
      ? 'export-snapshot'
      : 'corpus';

  let snapshot: string | undefined;
  let db: string | undefined;
  let out: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--snapshot' && args[i + 1]) snapshot = args[++i];
    if (args[i] === '--db' && args[i + 1]) db = args[++i];
    if (args[i] === '--out' && args[i + 1]) out = args[++i];
  }

  return { command, snapshot, db, out };
}

async function runCorpus(snapshotPath?: string): Promise<void> {
  const extraBenign = snapshotPath
    ? await loadProdSnapshotBenign(resolve(repoRoot, snapshotPath))
    : [];

  const report = await buildCorpusReportFromRepo(repoRoot, extraBenign);
  const md = formatCorpusReportMarkdown(report);
  const outPath = join(repoRoot, 'docs/reports/scan-corpus-latest.md');
  await mkdir(join(repoRoot, 'docs/reports'), { recursive: true });
  await writeFile(outPath, md, 'utf8');
  console.log(md);
  console.log(`\nWrote ${outPath}`);
}

async function runExportSnapshot(dbPath: string, outPath: string): Promise<void> {
  const snapshot = await exportProdSnapshotFile(
    resolve(dbPath),
    resolve(repoRoot, outPath),
  );
  console.log(
    `Exported ${snapshot.entries.length} public published version(s) to ${resolve(repoRoot, outPath)}`,
  );
}

async function main(): Promise<void> {
  const { command, snapshot, db, out } = parseArgs(process.argv);

  if (command === 'export-snapshot') {
    // exportProdSnapshotFile is retired (sqlite path); this call fails closed.
    const dbPath = db ?? process.env.DATABASE_URL ?? '(unset)'
    const outPath = out ?? 'docs/reports/prod-corpus-snapshot.json'
    await runExportSnapshot(dbPath, outPath)
    return
  }

  await runCorpus(snapshot);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
