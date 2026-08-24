/**
 * Measures the classifier we actually SHIP against the labeled corpus.
 *
 * There was already an eval harness and a labeled corpus, but `runClassifyEval`
 * scores `classifySkill` — the Haiku classifier, which is reachable from nothing
 * except the eval itself. Every production call site (publish, mirror sync,
 * queue approve, reclassify) uses `guessCategory`, the offline heuristic, and it
 * had never been scored at all. The first measurement put it at 30/39.
 *
 * An eval that greens on code you don't ship is worse than no eval, because it
 * reads as coverage. This one runs the shipped path.
 *
 * The floor is deliberately below the current score. The corpus is small enough
 * that a determined afternoon can tune it to 100% — which is a statement about
 * the corpus, not about the classifier — so treat the floor as a regression
 * alarm, not a quality bar. Raising real confidence means growing the corpus
 * with hand-labeled skills from the live catalog, not squeezing this number.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLASSIFY_EVAL_CORPUS } from '../src/classify/eval-corpus.js';
import { guessCategory } from '../src/classify/heuristic.js';
import { CATEGORY_KEYS } from '../src/categories.js';

/** Regression alarm, not a quality bar. See the note above. */
const MIN_ACCURACY = 0.9;

describe('category heuristic — labeled corpus (production path)', () => {
  it(`classifies at least ${Math.round(MIN_ACCURACY * 100)}% of the corpus correctly`, () => {
    const misses: string[] = [];
    let correct = 0;
    for (const c of CLASSIFY_EVAL_CORPUS) {
      const got = guessCategory({ slug: c.slug, description: c.description, body: c.body });
      if (got === c.expected) correct++;
      else misses.push(`${c.slug}: want ${c.expected}, got ${got ?? 'null (abstained)'}`);
    }
    const accuracy = correct / CLASSIFY_EVAL_CORPUS.length;
    assert.ok(
      accuracy >= MIN_ACCURACY,
      `accuracy ${(accuracy * 100).toFixed(1)}% (${correct}/${CLASSIFY_EVAL_CORPUS.length}) below the ${MIN_ACCURACY * 100}% floor:\n  ${misses.join('\n  ')}`,
    );
  });

  it('only ever returns a key from the closed taxonomy', () => {
    const keys = new Set<string>(CATEGORY_KEYS);
    for (const c of CLASSIFY_EVAL_CORPUS) {
      const got = guessCategory({ slug: c.slug, description: c.description, body: c.body });
      assert.ok(got === null || keys.has(got), `${c.slug} produced off-taxonomy ${got}`);
    }
  });

  it('no single term decides more than a third of the corpus', () => {
    // The guard that would have caught adding bare 'skill' to the agents list:
    // every skill in a catalog OF skills says "skill", so it swept 86 live
    // skills into agents while making the corpus look better. A term that alone
    // flips this much of the corpus is matching the medium, not the meaning.
    const baseline = CLASSIFY_EVAL_CORPUS.map((c) =>
      guessCategory({ slug: c.slug, description: c.description, body: c.body }),
    );
    const universal = ['skill', 'use when', 'agent', 'file', 'code', 'project'];
    for (const term of universal) {
      let flipped = 0;
      for (const [i, c] of CLASSIFY_EVAL_CORPUS.entries()) {
        const stripped = new RegExp(`\\b${term}\\b`, 'gi');
        const got = guessCategory({
          slug: c.slug.replace(stripped, ''),
          description: (c.description ?? '').replace(stripped, ''),
          body: c.body.replace(stripped, ''),
        });
        if (got !== baseline[i]) flipped++;
      }
      const share = flipped / CLASSIFY_EVAL_CORPUS.length;
      assert.ok(
        share <= 1 / 3,
        `removing "${term}" changes ${flipped}/${CLASSIFY_EVAL_CORPUS.length} verdicts — it is carrying the classification`,
      );
    }
  });
});
