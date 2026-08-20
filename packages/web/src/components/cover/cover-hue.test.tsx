import { describe, it, expect } from 'vitest'
import { coverHue } from './cover-hue'
import { UNCATEGORIZED_HUE } from '@skillet/protocol/covers'
import { CATEGORY_BY_KEY } from '@/lib/categories'

// coverHue drives the hero wash behind a skill cover; it must return the shared
// neutral hue for a genuinely-uncategorized single skill so the wash matches the
// engine's neutral ground instead of a fabricated category tint.
describe('coverHue', () => {
  it('returns the neutral hue for a single null-category skill', () => {
    expect(coverHue([null], 'k-dense-ai/biopython')).toBe(UNCATEGORIZED_HUE)
  })

  it('returns the neutral hue for an unknown category string', () => {
    expect(coverHue(['not-a-category'], 'some/seed')).toBe(UNCATEGORIZED_HUE)
  })

  it("returns a valid category's own hue (no regression)", () => {
    expect(coverHue(['research'], 'acme/demo')).toBe(CATEGORY_BY_KEY.research.hue)
  })

  it('a multi-member all-null kit still gets a seed fallback hue, not the neutral', () => {
    // A kit is decorative aggregate art — it keeps the seed fallback (any real
    // category hue), never the uncategorized neutral.
    const hue = coverHue([null, null], 'acme/kit')
    expect(hue).not.toBe(UNCATEGORIZED_HUE)
    const realHues = Object.values(CATEGORY_BY_KEY).map((c) => c.hue)
    expect(realHues).toContain(hue)
  })
})
