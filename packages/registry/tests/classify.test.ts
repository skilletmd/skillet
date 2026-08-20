import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { firstCategoryIn } from '../src/classify/index.js';
import { isCategoryKey, CATEGORY_KEYS, CATEGORY_BLURBS } from '../src/categories.js';
import { CLASSIFY_EVAL_CORPUS } from '../src/classify/eval-corpus.js';

// API-free tests: the parser robustness (the real bug) + corpus/taxonomy
// integrity. The accuracy eval itself needs ANTHROPIC_API_KEY and runs via
// `pnpm classify:eval`, not in CI.

describe('firstCategoryIn — robust parse of model output', () => {
  it('accepts a clean key', () => {
    assert.equal(firstCategoryIn('frontend'), 'frontend');
  });

  it('lowercases', () => {
    assert.equal(firstCategoryIn('Frontend'), 'frontend');
  });

  it('strips trailing punctuation', () => {
    assert.equal(firstCategoryIn('frontend.'), 'frontend');
  });

  it('strips a prefix', () => {
    assert.equal(firstCategoryIn('Category: backend'), 'backend');
  });

  it('takes the first key when the model returns two', () => {
    assert.equal(firstCategoryIn('frontend, design'), 'frontend');
  });

  it('does not match a key embedded in a larger word', () => {
    // "design" must not match inside "redesign".
    assert.equal(firstCategoryIn('redesigns are fun'), null);
  });

  it('returns null when nothing matches', () => {
    assert.equal(firstCategoryIn('I am not sure, maybe none of these'), null);
  });
});

describe('taxonomy integrity', () => {
  it('every category key has a blurb', () => {
    for (const key of CATEGORY_KEYS) {
      assert.ok(CATEGORY_BLURBS[key], `missing blurb for ${key}`);
    }
  });
});

describe('eval corpus integrity', () => {
  it('has unique ids', () => {
    const ids = CLASSIFY_EVAL_CORPUS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate case id');
  });

  it('every expected label is a real category', () => {
    for (const c of CLASSIFY_EVAL_CORPUS) {
      assert.ok(isCategoryKey(c.expected), `${c.id}: bad expected ${c.expected}`);
    }
  });

  it('covers every category at least once', () => {
    const covered = new Set(CLASSIFY_EVAL_CORPUS.map((c) => c.expected));
    for (const key of CATEGORY_KEYS) {
      assert.ok(covered.has(key), `no eval case covers ${key}`);
    }
  });
});
