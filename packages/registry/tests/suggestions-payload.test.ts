// A stored suggestion set outlives the skills it was generated from. These pin
// the read-time rule that keeps a profile from advertising a summon that misses.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { filterResolvableSuggestions, suggestionVoice } from '../src/suggestions/payload.js';

const s = (task: string, ref: string) => ({ task, ref });

describe('filterResolvableSuggestions', () => {
  it('keeps suggestions whose skill is still public', () => {
    const kept = filterResolvableSuggestions(
      [s('redo my site', '@a/one'), s('debug my build', '@a/two')],
      new Set(['@a/one', '@a/two']),
    );
    assert.equal(kept.length, 2);
  });

  it('drops a suggestion whose skill went private, and keeps the rest', () => {
    // Losing one line is not a reason to withhold the other two.
    const kept = filterResolvableSuggestions(
      [s('a', '@a/gone'), s('b', '@a/here'), s('c', '@a/also-here')],
      new Set(['@a/here', '@a/also-here']),
    );
    assert.deepEqual(kept.map((x) => x.ref), ['@a/here', '@a/also-here']);
  });

  it('returns empty when every skill behind the set is gone', () => {
    assert.deepEqual(filterResolvableSuggestions([s('a', '@a/gone')], new Set()), []);
  });

  it('does not resolve a ref belonging to another author', () => {
    // The generation probe once produced exactly this: another author's ref
    // carried onto a profile. The read path refuses it independently.
    assert.deepEqual(
      filterResolvableSuggestions([s('deploy', '@cloudflare/wrangler')], new Set(['@wshobson/x'])),
      [],
    );
  });

  it('passes an empty set through unchanged', () => {
    assert.deepEqual(filterResolvableSuggestions([], new Set(['@a/one'])), []);
  });
});

describe('suggestionVoice', () => {
  it('speaks about an unclaimed mirror, never as it', () => {
    assert.equal(suggestionVoice(true), 'third-person');
  });

  it('speaks as the author once the profile is claimed', () => {
    assert.equal(suggestionVoice(false), 'first-person');
  });
});
