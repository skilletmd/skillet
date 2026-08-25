// "Do we already have this?" — the question the mirror queue could not answer.
//
// Exact slug matching catches a second `code-review` and misses `pr-reviewer`,
// which is the case that matters. These pin that near-matches are caught, that
// unrelated skills stay apart, and that marketing filler cannot manufacture a
// match between two skills that share nothing else.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  OVERLAP_THRESHOLD,
  bestOverlap,
  buildOverlapIndex,
  skillTokens,
  type CatalogSkill,
} from '../src/lib/mirror-overlap.js'

const CATALOG: CatalogSkill[] = [
  { author: 'every', slug: 'code-review', description: 'Reviews a pull request for correctness, regressions, and missing tests' },
  { author: 'wshobson', slug: 'invoice-reconciliation', description: 'Reconciles supplier invoices against the accounting ledger' },
  { author: 'expo', slug: 'expo-animation', description: 'Builds animated screens with reanimated and gesture handler' },
  { author: 'google', slug: 'gke-observability', description: 'Instruments kubernetes workloads with prometheus and grafana dashboards' },
  { author: 'phuryn', slug: 'market-sizing', description: 'Estimates a total addressable market from bottom-up assumptions' },
  { author: 'obra', slug: 'using-git-worktrees', description: 'Isolates parallel work in separate git worktrees' },
]
const index = buildOverlapIndex(CATALOG)

describe('finding what the catalog already has', () => {
  it('matches a near-duplicate under a different name', () => {
    // KTD3 exists for exactly this: `pr-reviewer` is not `code-review` by slug
    // and is the same skill by intent.
    const hit = bestOverlap(index, {
      slug: 'pr-reviewer',
      name: 'PR Reviewer',
      description: 'Reviews pull requests for correctness and missing tests',
    })
    assert.ok(hit)
    assert.equal(hit.ref, 'every/code-review')
    assert.ok(hit.score >= OVERLAP_THRESHOLD, `scored ${hit.score}`)
  })

  it('scores an exact duplicate at the ceiling', () => {
    const hit = bestOverlap(index, {
      slug: 'code-review',
      description: 'Reviews a pull request for correctness, regressions, and missing tests',
    })
    assert.ok(hit)
    assert.equal(hit.ref, 'every/code-review')
    assert.ok(hit.score > 0.99, `scored ${hit.score}`)
  })

  it('keeps two genuinely unrelated skills apart', () => {
    const hit = bestOverlap(index, {
      slug: 'css-grid-helper',
      description: 'Builds responsive CSS grid layouts for a marketing site',
    })
    // A hit may exist; what matters is that it does not read as a duplicate.
    assert.ok(!hit || hit.score < OVERLAP_THRESHOLD, `scored ${hit?.score} against ${hit?.ref}`)
  })

  it('does not let marketing filler manufacture a match', () => {
    // Two skills whose only shared words are "the best, most powerful skill"
    // must not find each other. The rubric already refuses to credit those
    // words; scoring must refuse to count them too.
    const filler = 'The best, most powerful, comprehensive skill you will ever use'
    const noise = buildOverlapIndex([
      { author: 'a', slug: 'thing-one', description: filler },
      ...CATALOG,
    ])
    const hit = bestOverlap(noise, { slug: 'thing-two', description: filler })
    assert.ok(!hit || hit.score < OVERLAP_THRESHOLD, `scored ${hit?.score} against ${hit?.ref}`)
  })

  it('returns nothing for an empty catalog rather than dividing by zero', () => {
    const empty = buildOverlapIndex([])
    assert.equal(bestOverlap(empty, { slug: 'anything', description: 'Does a thing' }), null)
  })

  it('returns nothing for a candidate with no words to compare on', () => {
    assert.equal(bestOverlap(index, { slug: '', name: null, description: null }), null)
  })
})

describe('what counts as a word', () => {
  it('folds inflections so reviewer, reviews, and reviewing meet', () => {
    const a = skillTokens('pr-reviewer')
    const b = skillTokens('Reviews pull requests')
    const c = skillTokens('reviewing code')
    assert.ok(a.has('review'))
    assert.ok(b.has('review'))
    assert.ok(c.has('review'))
  })

  it('drops the words every skill uses about itself', () => {
    const t = skillTokens('This skill helps the agent use your data')
    assert.deepEqual([...t], ['data'])
  })

  it('drops marketing no-ops', () => {
    const t = skillTokens('A powerful, comprehensive, seamless invoice tool')
    assert.ok(t.has('invoic') || t.has('invoice'))
    assert.ok(!t.has('powerful'))
    assert.ok(!t.has('comprehensive'))
    assert.ok(!t.has('seamless'))
  })
})

describe('the threshold is a judgement, not a formality', () => {
  it('sits where the near-matches survive', () => {
    // Calibrated against 463 cross-author best matches in the real catalog.
    // 0.50 would drop `ce-debug` against `diagnosing-bugs` (0.49), which is a
    // real duplicate and the whole reason near-matching exists.
    assert.ok(OVERLAP_THRESHOLD > 0.4 && OVERLAP_THRESHOLD < 0.5)
  })
})
