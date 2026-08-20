// Pure parse/prompt logic for the claude-CLI backfill backend. The subprocess
// call itself is exercised live by the backfill run, not unit-tested here.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBatchPrompt,
  parseBatchResult,
} from '../scripts/lib/claude-cli-classify.js';

describe('buildBatchPrompt', () => {
  it('includes each skill id and truncates long descriptions', () => {
    const prompt = buildBatchPrompt([
      { id: 'acme:bio', slug: 'bio', description: 'x'.repeat(1000) },
    ]);
    assert.ok(prompt.includes('acme:bio'));
    // 400-char cap on the description.
    assert.ok(!prompt.includes('x'.repeat(401)));
    assert.ok(prompt.includes('research'), 'lists the taxonomy keys');
  });
});

describe('parseBatchResult', () => {
  it('parses a clean JSON array', () => {
    const m = parseBatchResult('[{"id":"a","category":"research"},{"id":"b","category":"backend"}]');
    assert.equal(m.get('a'), 'research');
    assert.equal(m.get('b'), 'backend');
  });

  it('tolerates code fences and leading prose', () => {
    const m = parseBatchResult('Sure, here you go:\n```json\n[{"id":"a","category":"design"}]\n```');
    assert.equal(m.get('a'), 'design');
  });

  it('returns an empty map on unparseable text (never throws)', () => {
    assert.equal(parseBatchResult('no json here').size, 0);
    assert.equal(parseBatchResult('[not valid json').size, 0);
  });

  it('skips malformed entries', () => {
    const m = parseBatchResult('[{"id":"a","category":"research"},{"nope":true},{"id":5,"category":"x"}]');
    assert.equal(m.size, 1);
    assert.equal(m.get('a'), 'research');
  });
});
