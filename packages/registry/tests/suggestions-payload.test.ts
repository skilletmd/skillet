// A stored suggestion set outlives the skills it was generated from. These pin
// the read-time rule that keeps a profile from advertising a summon that misses.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterResolvableSuggestions,
  suggestionVoice,
  validateEditedSuggestions,
} from '../src/suggestions/payload.js';

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

describe('validateEditedSuggestions', () => {
  const owned = new Set(['@me/one', '@me/two']);

  it('accepts an author\'s own lines pointing at their own public skills', () => {
    const r = validateEditedSuggestions(
      [{ task: 'Redo my site!', ref: '@me/one' }, { task: 'debug my build', ref: '@me/two' }],
      owned,
    );
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.suggestions.length, 2);
  });

  it("allows punctuation and capitals a model's output would be rejected for", () => {
    // A person editing their own profile is not model output to be discarded.
    assert.equal(validateEditedSuggestions([{ task: 'Fix my app.', ref: '@me/one' }], owned).ok, true);
  });

  it('rejects a ref for a skill this author does not own or that is not public', () => {
    assert.deepEqual(
      validateEditedSuggestions([{ task: 'deploy', ref: '@someone-else/x' }], owned),
      { ok: false, error: 'unknown_ref' },
    );
    assert.deepEqual(
      validateEditedSuggestions([{ task: 'deploy', ref: '@me/private' }], owned),
      { ok: false, error: 'unknown_ref' },
    );
  });

  it('rejects more than the cap', () => {
    const four = Array.from({ length: 4 }, () => ({ task: 'x', ref: '@me/one' }));
    assert.deepEqual(validateEditedSuggestions(four, owned), {
      ok: false,
      error: 'too_many_suggestions',
    });
  });

  it('rejects an empty, over-long, or control-character task', () => {
    assert.equal(validateEditedSuggestions([{ task: '  ', ref: '@me/one' }], owned).ok, false);
    assert.equal(
      validateEditedSuggestions([{ task: 'x'.repeat(61), ref: '@me/one' }], owned).ok,
      false,
    );
    assert.equal(
      validateEditedSuggestions([{ task: 'redo\u0000my site', ref: '@me/one' }], owned).ok,
      false,
    );
  });

  it('accepts an empty array, which clears the block', () => {
    const r = validateEditedSuggestions([], owned);
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.suggestions.length, 0);
  });

  it('rejects anything that is not an array of objects', () => {
    assert.deepEqual(validateEditedSuggestions('nope', owned), {
      ok: false,
      error: 'malformed_suggestions',
    });
    assert.deepEqual(validateEditedSuggestions([null], owned), {
      ok: false,
      error: 'malformed_suggestions',
    });
  });
});
