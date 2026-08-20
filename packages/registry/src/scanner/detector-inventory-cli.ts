#!/usr/bin/env node
// Generator + staleness check for the committed detector inventory manifest.
//
//   pnpm --filter @skillet/registry scan:inventory            # regenerate
//   pnpm --filter @skillet/registry scan:inventory -- --check # CI/staleness
//
// Default mode rebuilds `packages/web/src/lib/scan-detector-inventory.json` from
// the live detector sources. `--check` rebuilds in-memory and fails if the
// committed file is out of date — the same shape as a generated-types check, so
// a detector change that isn't regenerated breaks the build instead of silently
// shipping stale cross-reference copy on `/labs/scanner`.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { CAPABILITY_ORDER } from './capabilities/types.js';
import { buildInventoryFromDir, serializeInventory } from './detector-inventory.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../..');
const detectorsDir = join(here, 'detectors/threat');
const manifestPath = join(repoRoot, 'packages/web/src/lib/scan-detector-inventory.json');

async function main(): Promise<void> {
  const check = process.argv.slice(2).includes('--check');
  const inventory = await buildInventoryFromDir(detectorsDir, CAPABILITY_ORDER);
  const next = serializeInventory(inventory);

  if (check) {
    let committed: string | null = null;
    try {
      committed = await readFile(manifestPath, 'utf8');
    } catch {
      committed = null;
    }
    if (committed !== next) {
      console.error(
        `[detector-inventory] STALE: ${manifestPath}\n` +
          `Run \`pnpm --filter @skillet/registry scan:inventory\` and commit the result.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log('[detector-inventory] up to date');
    return;
  }

  await writeFile(manifestPath, next, 'utf8');
  console.log(
    `[detector-inventory] wrote ${manifestPath} ` +
      `(${Object.keys(inventory.threatCategories).length} categories, ` +
      `${inventory.capabilities.length} capabilities, ` +
      `${inventory.partialDetectors.length} partial)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
