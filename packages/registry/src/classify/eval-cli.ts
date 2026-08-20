#!/usr/bin/env node
// CLI for the category-classifier eval. Needs a real key:
//   ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @skillet/registry classify:eval
// Writes a markdown report and prints it. Exit 1 on hard failure (no key).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { runClassifyEval, formatClassifyEvalMarkdown } from './eval.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../..');

async function main(): Promise<void> {
  const report = await runClassifyEval();
  const md = formatClassifyEvalMarkdown(report);
  const outDir = join(repoRoot, 'docs/reports');
  const outPath = join(outDir, 'classify-eval-latest.md');
  await mkdir(outDir, { recursive: true });
  await writeFile(outPath, md, 'utf8');
  console.log(md);
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
