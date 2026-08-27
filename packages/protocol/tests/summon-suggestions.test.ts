/**
 * The stored shape has three independent readers (registry write, profile read,
 * backfill generate), so the parse/serialize boundary is where they agree or
 * silently drift. These pin the two distinctions that carry meaning — absent vs
 * empty, and drifted vs unchanged — plus the refusal to truncate.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SUMMON_SUGGESTIONS,
  kitSignature,
  parseSummonSuggestionSet,
  serializeSummonSuggestionSet,
  signatureDrifted,
  summonSuggestionLine,
} from '../src/summon-suggestions.js';

describe('parseSummonSuggestionSet', () => {
  it('reads absent as null, not as an empty set', () => {
    // Absent means the backfill still owes this author a set; empty means it
    // already ran and found nothing. Collapsing them would loop forever.
    assert.equal(parseSummonSuggestionSet(null), null);
    assert.equal(parseSummonSuggestionSet(undefined), null);
    assert.equal(parseSummonSuggestionSet(''), null);
  });

  it('reads a stored empty set as empty, not as absent', () => {
    const set = parseSummonSuggestionSet('{"suggestions":[],"kit_signature":"2|writing:2"}');
    assert.notEqual(set, null);
    assert.deepEqual(set!.suggestions, []);
    assert.equal(set!.kit_signature, '2|writing:2');
  });

  it('round-trips a set with its refs intact', () => {
    const original = {
      suggestions: [
        { task: 'redo my site', ref: '@wshobson/responsive-design' },
        { task: 'debug my build', ref: '@wshobson/debugging-strategies' },
      ],
      kit_signature: '173|frontend:40,quality:30',
    };
    assert.deepEqual(parseSummonSuggestionSet(serializeSummonSuggestionSet(original)), original);
  });

  it('rejects an over-length set rather than truncating it to a plausible three', () => {
    const four = JSON.stringify({
      suggestions: Array.from({ length: MAX_SUMMON_SUGGESTIONS + 1 }, (_, i) => ({
        task: `task ${i}`,
        ref: `@a/s${i}`,
      })),
      kit_signature: 'x',
    });
    assert.equal(parseSummonSuggestionSet(four), null);
  });

  it('drops an entry missing a task or a ref', () => {
    const raw = JSON.stringify({
      suggestions: [
        { task: 'redo my site', ref: '@a/b' },
        { task: '   ', ref: '@a/c' },
        { task: 'no ref here' },
      ],
      kit_signature: 'x',
    });
    assert.deepEqual(parseSummonSuggestionSet(raw)!.suggestions, [
      { task: 'redo my site', ref: '@a/b' },
    ]);
  });

  it('returns null on malformed JSON instead of throwing into a profile read', () => {
    assert.equal(parseSummonSuggestionSet('{not json'), null);
    assert.equal(parseSummonSuggestionSet('[]'), null);
    assert.equal(parseSummonSuggestionSet('"a string"'), null);
  });
});

describe('serializeSummonSuggestionSet', () => {
  it('refuses to store more than the cap', () => {
    assert.throws(
      () =>
        serializeSummonSuggestionSet({
          suggestions: Array.from({ length: 4 }, (_, i) => ({ task: `t${i}`, ref: `@a/s${i}` })),
          kit_signature: 'x',
        }),
      /cap is 3/,
    );
  });

  it('drops fields the shape does not carry', () => {
    const stored = serializeSummonSuggestionSet({
      suggestions: [{ task: 'a', ref: '@a/b', extra: 'nope' } as never],
      kit_signature: 'x',
    });
    assert.ok(!stored.includes('extra'));
  });
});

describe('kitSignature', () => {
  it('is stable regardless of row order', () => {
    assert.equal(
      kitSignature(['frontend', 'quality', 'frontend']),
      kitSignature(['quality', 'frontend', 'frontend']),
    );
  });

  it('counts uncategorized skills rather than dropping them', () => {
    assert.equal(kitSignature([null, null, 'writing']), '3|uncategorized:2,writing:1');
  });

  it('distinguishes kits of the same size with a different spread', () => {
    assert.notEqual(kitSignature(['frontend', 'frontend']), kitSignature(['frontend', 'backend']));
  });
});

describe('signatureDrifted', () => {
  const base = kitSignature(Array.from({ length: 40 }, () => 'frontend'));

  it('treats a never-generated set as drifted', () => {
    assert.equal(signatureDrifted(null, base), true);
  });

  it('is not drifted when the shape is unchanged', () => {
    assert.equal(signatureDrifted(base, base), false);
  });

  it('is not drifted by one publish into a large kit', () => {
    const plusOne = kitSignature(Array.from({ length: 41 }, () => 'frontend'));
    assert.equal(signatureDrifted(base, plusOne), false);
  });

  it('is drifted by the first skill in a new category, however small', () => {
    // A whole area of the kit going unrepresented is the case worth a call.
    const newCategory = kitSignature([...Array.from({ length: 40 }, () => 'frontend'), 'finance']);
    assert.equal(signatureDrifted(base, newCategory), true);
  });

  it('is drifted by a bulk mirror re-sync', () => {
    const plusForty = kitSignature(Array.from({ length: 80 }, () => 'frontend'));
    assert.equal(signatureDrifted(base, plusForty), true);
  });

  it('treats an unparseable stored signature as drifted', () => {
    assert.equal(signatureDrifted('garbage', base), true);
  });
});

describe('summonSuggestionLine', () => {
  it('renders the full copyable line, handle included', () => {
    assert.equal(summonSuggestionLine('wshobson', 'redo my site'), '/skillet @wshobson redo my site');
  });

  it('accepts a handle with or without the leading @', () => {
    assert.equal(
      summonSuggestionLine('@wshobson', 'redo my site'),
      summonSuggestionLine('wshobson', 'redo my site'),
    );
  });
});
