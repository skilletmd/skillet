import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KitCard } from './kit-card'
import { kitCoverCategories } from './directory-card'
import { isCategoryKey } from '@/lib/categories'

/**
 * An author kit is served public-only, because it is exactly what a subscriber
 * receives. That makes the count wrong for one viewer: the owner, whose
 * unpublished work is not in it. "0 skills" on your own profile right after an
 * upload reads as a lost upload, so the owner is shown both numbers and the
 * private one is never folded into the total a subscriber would see.
 */
const base = {
  kitId: 'kit-1',
  name: 'taylor',
  owner: 'taylor',
  skillRefs: [],
  skillCategories: [],
  href: '/taylor',
  // The count only replaces the byline on own-profile grids, where the page
  // already names the owner.
  hideOwner: true,
}

describe('KitCard skill count', () => {
  it('says "N skills" when there is nothing private to report', () => {
    render(<KitCard {...base} skillCount={3} />)
    expect(screen.getByText(/3 skills/)).toBeInTheDocument()
    expect(screen.queryByText(/private/)).not.toBeInTheDocument()
  })

  it('names published and private separately for the owner', () => {
    render(<KitCard {...base} skillCount={0} privateCount={1} />)
    expect(screen.getByText(/0 published · 1 private/)).toBeInTheDocument()
    // The bare "0 skills" reading is what made an upload look lost.
    expect(screen.queryByText(/^0 skills$/)).not.toBeInTheDocument()
  })

  it('keeps private out of the published total', () => {
    render(<KitCard {...base} skillCount={2} privateCount={3} />)
    expect(screen.getByText(/2 published · 3 private/)).toBeInTheDocument()
    expect(screen.queryByText(/5 skills/)).not.toBeInTheDocument()
  })
})

describe('kitCoverCategories cover fallback', () => {
  // An empty kit (no members) must never render blank: it still gets a
  // deterministic seed spread of >= 2 valid categories, so the engine paints a
  // real generative kit cover ("waves") rather than a blank or banded ground.
  it('gives an empty kit a paintable seed spread, never blank', () => {
    const cats = kitCoverCategories([], null, 0, 'owner/kit')
    expect(cats.length).toBeGreaterThanOrEqual(2)
    expect(cats.every((c) => isCategoryKey(c))).toBe(true)
  })

  // Deterministic: the same kit always paints the same cover.
  it('is deterministic per seed', () => {
    expect(kitCoverCategories([], null, 0, 'owner/kit')).toEqual(
      kitCoverCategories([], null, 0, 'owner/kit'),
    )
  })

  // Real member categories pass straight through to the engine.
  it('passes real categories through unchanged', () => {
    const input = ['research', 'frontend', null]
    expect(kitCoverCategories(input, null, 3, 'owner/kit')).toBe(input)
  })
})
