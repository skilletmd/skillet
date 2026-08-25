// The pending queue has to carry the reason to decide.
//
// It showed Handle / Source / Type / License and Approve / Reject, and every row
// read "User, MIT" — nothing to choose on. Discovery had already scored each
// candidate and written the breakdown to screen_notes; the page rendered that
// field only in "Recent decisions", so the reasoning appeared AFTER the decision
// and was hidden where the decision is made.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const page = readFileSync(join(process.cwd(), 'src/app/admin/mirror/page.tsx'), 'utf8')

// A real note from prod, 2026-08-25.
const REAL_NOTE =
  'quality 84/100 across 24 skills — frontmatter valid in 5/5 sampled: 30/30; ' +
  'descriptions state a capability (no marketing words): 4/20; ' +
  'bodies structured (sections + substance): 15/15; not router/index skills: 10/10; ' +
  'provenance (Organization, 224d old, pushed 2d ago): 20/20; stars 10950: 5/5'

describe('the pending table shows the screen', () => {
  it('renders a quality score and skill count', () => {
    expect(page).toMatch(/Quality</)
    expect(page).toMatch(/Skills</)
    expect(page).toMatch(/screenSummary\(c\.screen_notes\)/)
  })

  it('ranks best-first instead of arbitrary order', () => {
    // 64 rows in discovery order is a list you scroll past.
    expect(page).toMatch(/\.sort\(/)
    expect(page).toMatch(/screenSummary\(b\.screen_notes\)\.score/)
  })

  it('keeps the full breakdown reachable on the row', () => {
    expect(page).toMatch(/title=\{c\.screen_notes/)
  })
})

describe('parsing the note discovery wrote', () => {
  // Reimplemented from the page's own regexes: the page is a server component,
  // so this asserts the shapes it depends on still match a real prod note.
  const head = /^quality (\d+)\/100 across (\d+) skills/.exec(REAL_NOTE)
  const stars = /stars ([\d,]+):/.exec(REAL_NOTE)

  it('reads score, skill count, and stars', () => {
    expect(head?.[1]).toBe('84')
    expect(head?.[2]).toBe('24')
    expect(stars?.[1]).toBe('10950')
  })

  it('finds the weakest component, which is the reason to look closer', () => {
    let weakest: string | null = null
    let worst = 1.1
    for (const m of REAL_NOTE.matchAll(/([^;—]+?):\s*(\d+)\/(\d+)/g)) {
      const ratio = Number(m[2]) / Number(m[3])
      if (ratio < worst) {
        worst = ratio
        weakest = m[1].trim()
      }
    }
    // 4/20 on descriptions is the one worth a second look on this candidate.
    expect(weakest).toContain('descriptions state a capability')
    expect(worst).toBeCloseTo(0.2)
  })

  it('strips the value a label carries, so the line is not two numbers', () => {
    // The note says "stars 5: 0/5" — 5 stars scoring 0 of 5 points. Rendered
    // raw that was "weakest: stars 5 0/5", which reads as gibberish, and the
    // star count is already shown beside the repo.
    const clean = (raw: string) => {
      const m = /([^;—]+?):\s*(\d+)\/(\d+)/.exec(raw)!
      const label = m[1].trim().replace(/\s*\([^)]*\)/, '').replace(/\s+[\d,]+$/, '')
      return `${label} ${m[2]}/${m[3]}`
    }
    expect(clean('stars 5: 0/5')).toBe('stars 0/5')
    expect(clean('stars 10,950: 5/5')).toBe('stars 5/5')
    expect(clean('provenance (User, 237d old, pushed 0d ago): 10/20')).toBe('provenance 10/20')
    // A label with no embedded value keeps every word.
    expect(clean('bodies structured (sections + substance): 15/15')).toBe('bodies structured 15/15')
  })

  it('degrades to nulls rather than throwing on an unscored row', () => {
    expect(/^quality (\d+)\/100/.exec('')).toBeNull()
    expect(/^quality (\d+)\/100/.exec('submitted by hand')).toBeNull()
  })
})
