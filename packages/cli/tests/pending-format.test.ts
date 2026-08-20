import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPendingRange } from '../src/commands/pending.js';

test('formatPendingRange falls back to integers on both sides', () => {
  assert.equal(formatPendingRange({ approvedVersion: 1, incomingVersion: 2 }), 'v1 → v2');
});

test('formatPendingRange stays ordinal on both sides when one label is missing (no mixing)', () => {
  // Only the incoming side has a semver label — the range must NOT render
  // `v1 → v2.1.0` (a bare ordinal against a semver label). Both fall back to
  // ordinals so the two ends read as the same shape.
  assert.equal(
    formatPendingRange({ approvedVersion: 1, incomingVersion: 2, incomingVersionLabel: '2.1.0' }),
    'v1 → v2',
  );
});

test('formatPendingRange labels both sides when present', () => {
  assert.equal(
    formatPendingRange({
      approvedVersion: 1,
      approvedVersionLabel: '1.0.0',
      incomingVersion: 2,
      incomingVersionLabel: '2.0.0',
    }),
    'v1.0.0 → v2.0.0',
  );
});

test('formatPendingRange renders never-approved skills as new', () => {
  assert.equal(
    formatPendingRange({ approvedVersion: null, incomingVersion: 1, incomingVersionLabel: '1.0.0' }),
    'new (v1.0.0)',
  );
  assert.equal(formatPendingRange({ approvedVersion: null, incomingVersion: 1 }), 'new (v1)');
});
