// Pure prompt/parse logic for the claude-CLI phrasing backend. The subprocess
// call itself is exercised live by the backfill run, matching the convention in
// claude-cli-classify.test.ts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSuggestPrompt,
  parseSuggestResult,
  resolvePicks,
  type SuggestPick,
} from '../scripts/lib/claude-cli-suggest.js';
import type { SuggestionCluster } from '../src/suggestions/cluster.js';

const skill = (slug: string, description: string, category: string) => ({
  ref: `@a/${slug}`,
  slug,
  description,
  category,
});

const cluster = (
  category: string,
  slug: string,
  description: string,
  ...rest: Array<[string, string]>
): SuggestionCluster => ({
  category,
  size: 5,
  representative: skill(slug, description, category),
  candidates: [
    skill(slug, description, category),
    ...rest.map(([s, d]) => skill(s, d, category)),
  ],
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

  it('offers every candidate, not just the top-ranked one', () => {
    // Rank alone picks the kit's plumbing often enough that the choice has to
    // be the model's. It cannot choose past what the prompt shows it.
    const prompt = buildSuggestPrompt([
      cluster('agents', 'codex', 'OpenAI Codex CLI wrapper', ['pair-agent', 'Pair on a task']),
    ]);
    assert.ok(prompt.includes('codex'));
    assert.ok(prompt.includes('pair-agent'));
  });

  it('names the failure mode it is trying to avoid', () => {
    const prompt = buildSuggestPrompt([cluster('agents', 'codex', 'wrapper')]);
    assert.match(prompt, /never the tool's own name/);
    assert.match(prompt, /run codex/);
  });

  it('lets an all-plumbing area be omitted rather than named', () => {
    const prompt = buildSuggestPrompt([cluster('devops', 'setup', 'Wire up the gateway')]);
    assert.match(prompt, /OMIT the area entirely/);
  });
});

describe('parseSuggestResult', () => {
  it('parses a clean JSON array', () => {
    const m = parseSuggestResult(
      '[{"n":1,"slug":"site","task":"redo my site"},{"n":2,"slug":"build","task":"debug my build"}]',
    );
    assert.deepEqual(m.get(1), { slug: 'site', task: 'redo my site' });
    assert.deepEqual(m.get(2), { slug: 'build', task: 'debug my build' });
  });

  it('tolerates code fences and leading prose', () => {
    const m = parseSuggestResult('Sure:\n```json\n[{"n":1,"slug":"s","task":"Redo My Site"}]\n```');
    assert.equal(m.get(1)?.task, 'redo my site');
  });

  it('returns an empty map on unparseable text (never throws)', () => {
    assert.equal(parseSuggestResult('no json here').size, 0);
    assert.equal(parseSuggestResult('[not valid json').size, 0);
    assert.equal(parseSuggestResult('').size, 0);
  });

  it('skips malformed entries instead of failing the batch', () => {
    const m = parseSuggestResult('[{"n":1,"task":"ok"},{"nope":true},{"n":"2","task":"x"}]');
    assert.equal(m.size, 1);
    assert.equal(m.get(1)?.task, 'ok');
  });

  it('leaves the slug empty when the reply omits one', () => {
    // The caller reads that as "no choice made" and falls back to the cluster's
    // representative, rather than dropping a line over a missing field.
    const m = parseSuggestResult('[{"n":1,"task":"redo my site"}]');
    assert.equal(m.get(1)?.slug, '');
  });
});

describe('resolvePicks', () => {
  const picks = (...rows: Array<[number, string, string]>) =>
    new Map<number, SuggestPick>(rows.map(([n, slug, task]) => [n, { slug, task }]));

  it('stores the ref of the skill the model chose, not the top-ranked one', () => {
    const c = cluster('agents', 'codex', 'OpenAI Codex CLI wrapper', ['pair-agent', 'Pair on a task']);
    const out = resolvePicks([c], picks([1, 'pair-agent', 'pair on this feature']));
    assert.deepEqual(out, [{ task: 'pair on this feature', ref: '@a/pair-agent' }]);
  });

  it('drops a cluster the model declined rather than filling it', () => {
    const c = cluster('devops', 'setup', 'Wire up the gateway');
    assert.deepEqual(resolvePicks([c], picks()), []);
  });

  it('refuses a slug the cluster never offered', () => {
    // A cross-cluster or invented slug would hang a phrase on a skill it was
    // not written for. That is the one thing this pipeline must not do.
    const c = cluster('agents', 'codex', 'wrapper', ['pair-agent', 'Pair on a task']);
    assert.deepEqual(resolvePicks([c], picks([1, 'something-else', 'do the thing'])), []);
  });

  it('falls back to the representative when the reply names no slug', () => {
    const c = cluster('frontend', 'responsive', 'CSS grid layouts');
    const out = resolvePicks([c], picks([1, '', 'redo my site']));
    assert.deepEqual(out, [{ task: 'redo my site', ref: '@a/responsive' }]);
  });

  it('drops an unpublishable phrase even when the slug is valid', () => {
    const c = cluster('frontend', 'responsive', 'CSS grid layouts');
    assert.deepEqual(resolvePicks([c], picks([1, 'responsive', 'visit https://x.example'])), []);
  });

  it('keeps the good clusters when one of three is declined', () => {
    const out = resolvePicks(
      [cluster('a', 'x', 'one'), cluster('b', 'y', 'two'), cluster('c', 'z', 'three')],
      picks([1, 'x', 'do the first'], [3, 'z', 'do the third']),
    );
    assert.deepEqual(out.map((o) => o.ref), ['@a/x', '@a/z']);
  });
});
