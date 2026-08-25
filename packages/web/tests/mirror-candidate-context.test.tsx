// The queue row has to answer the three questions a decision turns on: what
// are these skills, do we need them, and do we already have them.
//
// Before this, a pending row showed a score, a handle, a repo, a skill count,
// and two buttons. That is enough to reject obvious junk and nothing more.
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CandidateSkills,
  CategorySummary,
  thinCategories,
  type CandidateSkill,
} from '@/app/admin/mirror/candidate-detail'

const page = readFileSync(join(process.cwd(), 'src/app/admin/mirror/page.tsx'), 'utf8')

/** The real public-catalog distribution, 2026-08-25. */
const REAL_COUNTS = {
  quality: 189, devops: 170, backend: 169, database: 113, product: 99,
  frontend: 90, writing: 88, agents: 79, security: 69, productivity: 69,
  mobile: 55, design: 53, marketing: 32, research: 30, media: 30,
  finance: 23, sales: 7,
}

function skill(over: Partial<CandidateSkill> = {}): CandidateSkill {
  return {
    slug: 'skills/thing',
    name: 'Thing',
    description: 'Does a thing',
    category: 'devops',
    overlap_ref: null,
    overlap_score: null,
    ...over,
  }
}

describe('which categories read as thin', () => {
  it('names the short lanes and leaves the well-covered ones alone', () => {
    const thin = thinCategories(REAL_COUNTS)
    expect([...thin].sort()).toEqual(['finance', 'marketing', 'media', 'research', 'sales'])
    expect(thin.has('quality')).toBe(false)
    expect(thin.has('backend')).toBe(false)
  })

  it('does not rely on a fixed floor, which cannot work across a 27x spread', () => {
    // Every category is populated and quality has 27x what sales has. A floor
    // low enough to spare sales (7) would call nothing thin.
    const thin = thinCategories(REAL_COUNTS)
    expect(thin.size).toBeGreaterThan(0)
    expect(thin.size).toBeLessThan(Object.keys(REAL_COUNTS).length)
  })

  it('moves with the catalog rather than being frozen at a number', () => {
    // Ten times the same catalog: the same lanes stay thin, so the rule is
    // about shape, not absolute size.
    const scaled = Object.fromEntries(
      Object.entries(REAL_COUNTS).map(([k, v]) => [k, v * 10]),
    )
    expect([...thinCategories(scaled)].sort()).toEqual([...thinCategories(REAL_COUNTS)].sort())
  })

  it('calls nothing thin in an empty catalog rather than everything', () => {
    expect(thinCategories({}).size).toBe(0)
  })
})

describe('the collapsed row', () => {
  it('marks a thin category and does not mark a well-covered one', () => {
    const thin = thinCategories(REAL_COUNTS)
    const html = renderToStaticMarkup(
      <CategorySummary summary={{ sales: 3, quality: 2 }} thin={thin} />,
    )
    expect(html).toContain('sales 3')
    expect(html).toContain('(thin)')
    expect(html).toContain('quality 2')
    // One "(thin)" for sales, none for quality.
    expect(html.split('(thin)').length - 1).toBe(1)
  })

  it('does not spill every category into the row', () => {
    const summary = Object.fromEntries(Object.keys(REAL_COUNTS).map((k) => [k, 1]))
    const html = renderToStaticMarkup(<CategorySummary summary={summary} thin={new Set()} />)
    // Three named, the rest counted. 17 lanes in a table cell is not scannable.
    expect(html).toContain('+14')
  })

  it('renders nothing for a row captured before categories existed', () => {
    expect(renderToStaticMarkup(<CategorySummary summary={null} thin={new Set()} />)).toBe('')
  })
})

describe('the expanded skill list', () => {
  const thin = thinCategories(REAL_COUNTS)

  it('names the skills, which is the whole point', () => {
    const html = renderToStaticMarkup(
      <CandidateSkills
        skills={[skill({ slug: 'skills/a', name: 'Ship It' }), skill({ slug: 'skills/b', name: 'Roll Back' })]}
        thin={thin}
        threshold={0.45}
      />,
    )
    expect(html).toContain('Ship It')
    expect(html).toContain('Roll Back')
  })

  it('falls back to the slug leaf when frontmatter gave us no name', () => {
    const html = renderToStaticMarkup(
      <CandidateSkills
        skills={[skill({ slug: 'nested/dir/pr-reviewer', name: null, description: null })]}
        thin={thin}
        threshold={0.45}
      />,
    )
    expect(html).toContain('pr-reviewer')
    expect(html).not.toContain('nested/dir')
  })

  it('keeps 57 skills behind a disclosure rather than in the row', () => {
    const many = Array.from({ length: 57 }, (_, i) => skill({ slug: `skills/s${i}`, name: `S${i}` }))
    const html = renderToStaticMarkup(
      <CandidateSkills skills={many} thin={thin} threshold={0.45} />,
    )
    expect(html).toContain('<details')
    expect(html).toContain('Show all 57 skills')
    // Not open by default: the collapsed row has to stay scannable.
    expect(html).not.toContain('<details open')
  })

  it('names the existing skill an overlap matched, so the claim is checkable', () => {
    const html = renderToStaticMarkup(
      <CandidateSkills
        skills={[skill({ overlap_ref: 'every/code-review', overlap_score: 0.72 })]}
        thin={thin}
        threshold={0.45}
      />,
    )
    expect(html).toContain('every/code-review')
    expect(html).toContain('href="/every/code-review"')
  })

  it('stays quiet about a match that scored below the threshold', () => {
    const html = renderToStaticMarkup(
      <CandidateSkills
        skills={[skill({ overlap_ref: 'every/code-review', overlap_score: 0.2 })]}
        thin={thin}
        threshold={0.45}
      />,
    )
    expect(html).not.toContain('every/code-review')
  })

  it('says so plainly when a row predates the capture', () => {
    // All 64 rows in the queue when this shipped were in exactly this state.
    const html = renderToStaticMarkup(
      <CandidateSkills skills={[]} thin={thin} threshold={0.45} />,
    )
    expect(html).toContain('No skills captured')
  })
})

describe('signals inform, they never gate', () => {
  it('leaves Approve and Reject unconditional in the page source', () => {
    // KTD5: a candidate that is 100% overlap and badly categorised still
    // renders with both buttons enabled. No overlap or category value may
    // appear in a disabled prop or a conditional around the forms.
    const actions = /<td className="py-3">[\s\S]*?<\/td>/.exec(page)
    expect(actions).toBeTruthy()
    expect(actions![0]).toContain("'approve'")
    expect(actions![0]).toContain("'reject'")
    expect(actions![0]).not.toMatch(/disabled/)
    expect(actions![0]).not.toMatch(/overlap|category/)
  })

  it('renders the detail row only when there is something to show', () => {
    // A legacy row must not render an empty expander under itself.
    expect(page).toMatch(/const expandable = Boolean\(c\.skills && c\.skills\.length > 0\)/)
  })
})
