// What the queue endpoint sends the admin page, and what it deliberately does
// not store.
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { candidateContext } from '../src/routes/mirror-queue.js'
import { OVERLAP_THRESHOLD } from '../src/lib/mirror-overlap.js'

const route = readFileSync(join(process.cwd(), 'src/routes/mirror-queue.ts'), 'utf8')

function skill(overlapScore: number | null) {
  return {
    slug: 's',
    name: null,
    description: null,
    category: null,
    overlap_ref: overlapScore == null ? null : 'every/code-review',
    overlap_score: overlapScore,
  }
}

describe('the decision context on a pending row', () => {
  it('counts only the skills that clear the threshold', () => {
    const ctx = candidateContext({
      skills_captured_at: 1,
      category_summary: { quality: 3 },
      mirror_candidate_skills: [
        { ...skill(OVERLAP_THRESHOLD + 0.1), slug: 'a' },
        { ...skill(OVERLAP_THRESHOLD), slug: 'b' },
        { ...skill(OVERLAP_THRESHOLD - 0.01), slug: 'c' },
        { ...skill(null), slug: 'd' },
      ],
    })
    assert.equal(ctx.overlap_count, 2)
  })

  it('derives the count instead of reading a stored column', () => {
    // The threshold is calibrated against a catalog that keeps growing. A
    // stored count would silently misrepresent every existing row the moment
    // it moves, and there would be no signal that it had.
    assert.doesNotMatch(route, /overlap_count:\s*r\./)
    assert.match(route, /overlap_count: skills\.filter\(/)
    const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')
    const model = /model mirror_review_queue \{([\s\S]*?)\n\}/.exec(schema)
    assert.ok(model)
    assert.doesNotMatch(model[1]!, /overlap_count/)
  })

  it('reads back a legacy row as empty rather than throwing', () => {
    // All 64 rows in the queue when this shipped had no captured context.
    const ctx = candidateContext({ skills_captured_at: null, category_summary: null })
    assert.equal(ctx.overlap_count, 0)
    assert.deepEqual(ctx.skills, [])
    assert.equal(ctx.category_summary, null)
    assert.equal(ctx.skills_captured_at, null)
  })
})

describe('catalog thinness is a fact about the catalog', () => {
  it('is counted once for the page, not once per row', () => {
    // 64 rows each carrying their own copy would be the same 17 numbers 64
    // times, and each one would be a separate query.
    assert.match(route, /prisma\.skills\.groupBy\(/)
    assert.match(route, /category_counts: categoryCounts/)
    const perRow = /pending: pending\.map\([\s\S]*?\)\),/.exec(route)
    assert.ok(perRow)
    assert.doesNotMatch(perRow[0], /groupBy/)
  })

  it('counts public skills only', () => {
    const block = /groupBy\(\{[\s\S]*?\}\),/.exec(route)
    assert.ok(block)
    assert.match(block[0], /visibility: 'public'/)
  })
})
