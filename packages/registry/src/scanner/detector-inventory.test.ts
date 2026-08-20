import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { CAPABILITY_ORDER } from './capabilities/types.js';
import {
  buildDetectorInventory,
  buildInventoryFromDir,
  serializeInventory,
} from './detector-inventory.js';

const here = dirname(fileURLToPath(import.meta.url));
const detectorsDir = join(here, 'detectors/threat');
const manifestPath = join(here, '../../../web/src/lib/scan-detector-inventory.json');

// --- pure builder, fixtures -------------------------------------------------

test('declared category + detector ids become detectors + why tags', () => {
  const inv = buildDetectorInventory(
    [
      {
        name: 'injection.ts',
        contents: `
          const PATTERNS = [
            { category: 'injection' as const, detector: 'ignore-previous', pattern: /x/ },
            { category: 'injection' as const, detector: 'jailbreak-dan', pattern: /y/ },
          ];
        `,
      },
    ],
    [],
  );
  assert.deepEqual(inv.threatCategories.injection, {
    detectors: ['ignore-previous', 'jailbreak-dan'],
    whyTags: ['injection:ignore-previous', 'injection:jailbreak-dan'],
  });
  assert.deepEqual(inv.partialDetectors, []);
});

test('a category with no static detector id is flagged partial', () => {
  const inv = buildDetectorInventory(
    [
      {
        name: 'risky-call.ts',
        // Category declared, but the `why` is built dynamically (no `detector:` literal).
        contents: `
          export const riskyCallDetector = () => {
            return [{ category: 'risky-call', why: \`risky-call:\${site.detector}\` }];
          };
        `,
      },
    ],
    [],
  );
  assert.deepEqual(inv.threatCategories['risky-call'], { detectors: [], whyTags: [] });
  assert.deepEqual(inv.partialDetectors, ['risky-call']);
});

test('detector ids attribute to the nearest preceding category', () => {
  // A single file declaring two categories pairs each detector with the
  // most-recent category, not the first one.
  const inv = buildDetectorInventory(
    [
      {
        name: 'multi.ts',
        contents: `
          { category: 'a', detector: 'a1' }
          { category: 'b', detector: 'b1' }
        `,
      },
    ],
    [],
  );
  assert.deepEqual(inv.threatCategories.a.detectors, ['a1']);
  assert.deepEqual(inv.threatCategories.b.detectors, ['b1']);
});

test('capabilities are carried through, sorted and deterministic', () => {
  const inv = buildDetectorInventory([], ['network', 'runs-shell', 'deletes-files']);
  assert.deepEqual(inv.capabilities, ['deletes-files', 'network', 'runs-shell']);
});

test('output is deterministic regardless of file/detector input order', () => {
  const a = buildDetectorInventory(
    [{ name: 'x.ts', contents: `{ category: 'c', detector: 'two' }{ category: 'c', detector: 'one' }` }],
    ['b', 'a'],
  );
  const b = buildDetectorInventory(
    [{ name: 'x.ts', contents: `{ category: 'c', detector: 'one' }{ category: 'c', detector: 'two' }` }],
    ['a', 'b'],
  );
  assert.equal(serializeInventory(a), serializeInventory(b));
});

// --- real roster ------------------------------------------------------------

test('the real detector roster yields a complete, honest inventory', async () => {
  const inv = await buildInventoryFromDir(detectorsDir, CAPABILITY_ORDER);

  // A representative threat category declares prose-readable why tags.
  assert.ok(inv.threatCategories.injection.whyTags.includes('injection:ignore-previous'));
  // risky-call is honestly partial: its AST call detectors derive `why` tags at
  // scan time, uninventoried even though latex.ts contributes static ids.
  assert.ok(inv.partialDetectors.includes('risky-call'));
  assert.deepEqual(inv.threatCategories['risky-call'].detectors, [
    'latex-input-pipe',
    'latex-lua-exec',
    'latex-shell-escape',
  ]);
  // The capability vocabulary matches the canonical order set.
  assert.deepEqual(inv.capabilities, [...CAPABILITY_ORDER].sort());
});

// --- staleness check (mirrors the CLI's --check) ----------------------------

test('committed manifest is up to date with the live detectors', async () => {
  const inv = await buildInventoryFromDir(detectorsDir, CAPABILITY_ORDER);
  const committed = await readFile(manifestPath, 'utf8');
  assert.equal(
    serializeInventory(inv),
    committed,
    'scan-detector-inventory.json is stale — run `pnpm --filter @skillet/registry scan:inventory` and commit.',
  );
});
