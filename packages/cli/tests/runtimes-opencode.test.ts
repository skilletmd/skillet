import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeLabel } from '@skillet/core';
import {
  ALL_ADAPTERS,
  BASELINE_READER_ADAPTERS,
} from '../src/cli-context.js';

// opencode reads the universal ~/.agents/skills baseline, so it is surfaced as a
// detected runtime for labeling but must NOT join the materializing set — being
// in ALL_ADAPTERS would double-write and double-count the shared baseline.

test('opencode is registered as a baseline-reader runtime', () => {
  const names = BASELINE_READER_ADAPTERS.map((a) => a.name);
  assert.ok(names.includes('opencode'), 'BASELINE_READER_ADAPTERS should include opencode');
});

test('opencode is NOT in the materializing adapter set (no double-write)', () => {
  const names = ALL_ADAPTERS.map((a) => a.name);
  assert.equal(
    names.includes('opencode'),
    false,
    'opencode must not materialize — the universal baseline already writes its skills',
  );
});

test('opencode has a friendly runtime label', () => {
  assert.equal(runtimeLabel('opencode'), 'opencode');
});

test('opencode adapter detect() resolves to a boolean', async () => {
  const opencode = BASELINE_READER_ADAPTERS.find((a) => a.name === 'opencode');
  assert.ok(opencode);
  const detected = await opencode.detect();
  assert.equal(typeof detected, 'boolean');
});
