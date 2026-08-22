import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { firstCategoryIn } from '../src/classify/index.js';
import { guessCategory } from '../src/classify/heuristic.js';
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

describe('guessCategory — the writing lane', () => {
  // countHits appends s/es/ing/ed but never strips, so 'writing' alone never
  // matched "writer" or "rewrite" and this real skill stayed uncategorized.
  it('categorizes prose work described with the nouns of the craft', () => {
    assert.equal(
      guessCategory({
        slug: 'book-prose-writer',
        description:
          "Rewrites text in Jason Cohen's prose style for the Hidden Multipliers book. Use when asked to rewrite, restyle, or edit prose for the book.",
      }),
      'writing',
    );
  });

  // Bare 'write'/'edit' were tried and rejected for exactly these: both read as
  // file operations far more often than as authorship.
  it('does not drag file-editing tooling into writing', () => {
    assert.notEqual(
      guessCategory({
        slug: 'freeze',
        description: 'Restrict file edits to a specific directory for the session.',
      }),
      'writing',
    );
    assert.notEqual(
      guessCategory({
        slug: 'document-api-endpoint',
        description:
          'Document and type a Sentry API endpoint. Write or fix @extend_schema decorators, specify response TypedDicts.',
      }),
      'writing',
    );
  });

  it('still returns null rather than mis-filing an unmatched skill', () => {
    assert.equal(guessCategory({ slug: 'zzz', description: 'zzz' }), null);
  });
});
