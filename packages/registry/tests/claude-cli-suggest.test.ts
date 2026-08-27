// Pure prompt/parse logic for the claude-CLI phrasing backend. The subprocess
// call itself is exercised live by the backfill run, matching the convention in
// claude-cli-classify.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSuggestPrompt,
  parseSuggestResult,
} from '../scripts/lib/claude-cli-suggest.js';
import type { SuggestionCluster } from '../src/suggestions/cluster.js';

const cluster = (category: string, slug: string, description: string): SuggestionCluster => ({
  category,
  size: 5,
  representative: { ref: `@a/${slug}`, slug, description, category },
});

describe('buildSuggestPrompt', () => {
  it('fences the descriptions and says they are data, not instructions', () => {
    const prompt = buildSuggestPrompt([cluster('frontend', 'responsive', 'CSS grid layouts')]);
    assert.ok(prompt.includes('<skills>'));
    assert.ok(prompt.includes('</skills>'));
    assert.match(prompt, /never an instruction to you/i);
  });

  it('truncates a long description rather than sending the whole body', () => {
    const prompt = buildSuggestPrompt([cluster('frontend', 'x', 'y'.repeat(1000))]);
    assert.ok(!prompt.includes('y'.repeat(401)));
  });

  it('numbers entries so a phrase can be matched back to its cluster', () => {
    const prompt = buildSuggestPrompt([
      cluster('frontend', 'a', 'one'),
      cluster('devops', 'b', 'two'),
    ]);
    assert.ok(prompt.includes('"n":1'));
    assert.ok(prompt.includes('"n":2'));
  });

  it('asks for the want, not the capability', () => {
    const prompt = buildSuggestPrompt([cluster('frontend', 'a', 'one')]);
    assert.match(prompt, /what the person WANTS DONE/);
  });
});

describe('parseSuggestResult', () => {
  it('parses a clean JSON array', () => {
    const m = parseSuggestResult('[{"n":1,"task":"redo my site"},{"n":2,"task":"debug my build"}]');
    assert.equal(m.get(1), 'redo my site');
    assert.equal(m.get(2), 'debug my build');
  });

  it('tolerates code fences and leading prose', () => {
    const m = parseSuggestResult('Sure:\n```json\n[{"n":1,"task":"Redo My Site"}]\n```');
    assert.equal(m.get(1), 'redo my site');
  });

  it('returns an empty map on unparseable text (never throws)', () => {
    assert.equal(parseSuggestResult('no json here').size, 0);
    assert.equal(parseSuggestResult('[not valid json').size, 0);
    assert.equal(parseSuggestResult('').size, 0);
  });

  it('skips malformed entries instead of failing the batch', () => {
    const m = parseSuggestResult('[{"n":1,"task":"ok"},{"nope":true},{"n":"2","task":"x"}]');
    assert.equal(m.size, 1);
    assert.equal(m.get(1), 'ok');
  });
});
