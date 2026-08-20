import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PERMISSIONS,
  FLAGS,
  SCAN_VOCABULARY,
  PERMISSION_ORDER,
  vocabularyEntry,
} from '../src/scan-vocabulary.js';

// The literal id sets this vocabulary must cover — copied from the registry's
// Capability union and threat Category union. Asserting against the literals
// (not derived from the maps) is what makes drift fail the test.
const CAPABILITY_IDS = [
  'runs-shell',
  'network',
  'writes-files',
  'deletes-files',
  'reads-secrets',
  'install-hooks',
  'connects-mcp-server',
  'executes-generated',
  'injects-output-content',
] as const;

const CATEGORY_IDS = [
  'injection',
  'exfil',
  'destructive',
  'obfuscation',
  'secret',
  'prompt-leak',
  'privilege-escalation',
  'supply-chain',
  'excessive-agency',
  'output-handling',
  'memory-poisoning',
  'tool-misuse',
  'rogue-agent',
  'risky-call',
  'output-injection',
] as const;

// Cross-check: the committed detector inventory the web ships against.
const inventory = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../web/src/lib/scan-detector-inventory.json', import.meta.url)), 'utf8'),
) as { threatCategories: Record<string, unknown>; capabilities: string[] };

describe('scan vocabulary', () => {
  it('resolves every capability id to a permission entry', () => {
    for (const id of CAPABILITY_IDS) {
      const entry = PERMISSIONS[id];
      assert.ok(entry, `missing permission: ${id}`);
      assert.equal(entry.kind, 'permission', id);
      assert.equal(entry.id, id, id);
      assert.ok(entry.label.length > 0, `empty label: ${id}`);
      assert.ok(entry.describe.length > 0, `empty describe: ${id}`);
      assert.equal(entry.fix, undefined, `permission must not carry a fix: ${id}`);
      assert.equal(entry.permission, undefined, `permission must not carry a permission tag: ${id}`);
      assert.equal(vocabularyEntry(id), entry, id);
    }
  });

  it('resolves every threat category id to a flag entry', () => {
    for (const id of CATEGORY_IDS) {
      const entry = FLAGS[id];
      assert.ok(entry, `missing flag: ${id}`);
      assert.equal(entry.kind, 'flag', id);
      assert.equal(entry.id, id, id);
      assert.ok(entry.label.length > 0, `empty label: ${id}`);
      assert.ok(entry.describe.length > 0, `empty describe: ${id}`);
      assert.ok(entry.fix && entry.fix.length > 0, `empty fix: ${id}`);
      assert.ok(
        entry.shape === 'action' || entry.shape === 'content',
        `flag must carry an action/content shape: ${id}`,
      );
      assert.equal(vocabularyEntry(id), entry, id);
    }
  });

  it('every permission carries no shape (flags only)', () => {
    for (const id of CAPABILITY_IDS) {
      assert.equal(PERMISSIONS[id].shape, undefined, `permission must not carry a shape: ${id}`);
    }
  });

  it('buckets each flag action-vs-content per the v1 split', () => {
    const action = [
      'exfil',
      'destructive',
      'risky-call',
      'supply-chain',
      'tool-misuse',
      'output-handling',
      'output-injection',
      'privilege-escalation',
      'excessive-agency',
      'rogue-agent',
    ];
    const content = ['injection', 'prompt-leak', 'obfuscation', 'secret', 'memory-poisoning'];
    for (const id of action) assert.equal(FLAGS[id].shape, 'action', id);
    for (const id of content) assert.equal(FLAGS[id].shape, 'content', id);
    // The two judgment calls are pinned so a future move is a deliberate edit.
    assert.equal(FLAGS['rogue-agent'].shape, 'action');
    assert.equal(FLAGS['memory-poisoning'].shape, 'content');
  });

  it('covers exactly the capabilities + categories in the detector inventory', () => {
    for (const id of inventory.capabilities) {
      assert.ok(PERMISSIONS[id], `inventory capability has no permission entry: ${id}`);
    }
    for (const id of Object.keys(inventory.threatCategories)) {
      assert.ok(FLAGS[id], `inventory category has no flag entry: ${id}`);
    }
  });

  it('every permission tag on a flag references a valid permission id', () => {
    for (const entry of Object.values(FLAGS)) {
      if (entry.permission === undefined) continue;
      assert.ok(PERMISSIONS[entry.permission], `unknown permission tag ${entry.permission} on ${entry.id}`);
    }
  });

  it('seeds the expected permission folds and leaves others standalone', () => {
    assert.equal(FLAGS['risky-call'].permission, 'runs-shell');
    assert.equal(FLAGS.destructive.permission, 'deletes-files');
    assert.equal(FLAGS['output-injection'].permission, 'injects-output-content');
    // exfil is deliberately standalone — a scarier signal than generic network use.
    assert.equal(FLAGS.exfil.permission, undefined);
    assert.equal(FLAGS.injection.permission, undefined);
  });

  it('PERMISSION_ORDER is exactly the 9 permission ids, no duplicates', () => {
    assert.equal(PERMISSION_ORDER.length, 9);
    assert.equal(new Set(PERMISSION_ORDER).size, 9);
    assert.deepEqual([...PERMISSION_ORDER].sort(), [...CAPABILITY_IDS].sort());
    for (const id of PERMISSION_ORDER) {
      assert.ok(PERMISSIONS[id], `order id has no permission entry: ${id}`);
    }
  });

  it('a previously-GENERIC category has authored label/describe/fix', () => {
    for (const id of ['tool-misuse', 'output-handling', 'memory-poisoning', 'rogue-agent']) {
      const entry = FLAGS[id];
      assert.ok(entry.label.length > 0, `empty label: ${id}`);
      assert.ok(entry.describe.length > 0, `empty describe: ${id}`);
      assert.ok(entry.fix && entry.fix.length > 0, `empty fix: ${id}`);
      // Not the GENERIC fallback copy.
      assert.notEqual(entry.describe, 'A pattern the scanner flags for a person to review.', id);
    }
  });

  it('merged SCAN_VOCABULARY holds all 24 ids', () => {
    assert.equal(Object.keys(SCAN_VOCABULARY).length, CAPABILITY_IDS.length + CATEGORY_IDS.length);
  });
});
