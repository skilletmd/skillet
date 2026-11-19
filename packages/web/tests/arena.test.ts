import { describe, expect, it } from 'vitest'
import { classifyRoute } from '@/lib/agent-routes'
import { ARENA_ROUNDS, neededFor, roundsForSkill } from '@/lib/arena/rounds'

describe('arena routes', () => {
  it('resolves the list, every round, and its vote screen', () => {
    expect(classifyRoute('/arena')).toEqual({ kind: 'known' })
    for (const round of ARENA_ROUNDS) {
      expect(classifyRoute(`/arena/${round.slug}`)).toEqual({ kind: 'known' })
      expect(classifyRoute(`/arena/${round.slug}/vote`)).toEqual({ kind: 'known' })
    }
  })

  // Decided before render: under cacheComponents a page-level notFound() would
  // already have sent a 200.
  it('404s a round that does not exist, and paths under a round that are not the vote screen', () => {
    expect(classifyRoute('/arena/not-a-round')).toEqual({ kind: 'unknown' })
    expect(classifyRoute('/arena/not-a-round/vote')).toEqual({ kind: 'unknown' })
    expect(classifyRoute(`/arena/${ARENA_ROUNDS[0]!.slug}/results`)).toEqual({ kind: 'unknown' })
  })
})

describe('arena bar', () => {
  // Exact one-sided sign test at 5%: the smallest win count luck reaches less
  // than 1 time in 20.
  it('matches the exact sign test at the counts a 48-brief round lands on', () => {
    expect(neededFor(48)).toBe(31)
    expect(neededFor(44)).toBe(28)
    expect(neededFor(40)).toBe(26)
    expect(neededFor(36)).toBe(24)
    expect(neededFor(32)).toBe(22)
  })

  it('keeps every closed result consistent with its own bar', () => {
    for (const round of ARENA_ROUNDS) {
      const result = round.result
      if (!result) continue
      const cleared = result.b >= neededFor(result.a + result.b)
      expect(result.verdict === 'won').toBe(cleared)
    }
  })
})

describe('arena data', () => {
  it('gives every open round screenshots for every pair', () => {
    for (const round of ARENA_ROUNDS.filter((r) => r.status === 'open')) {
      expect(round.pairs.length).toBeGreaterThan(0)
      for (const pair of round.pairs) expect(pair.shots).toBeDefined()
    }
  })

  it('finds a skill’s rounds by author and name', () => {
    expect(roundsForSkill('identity-md', 'frontend-for-contract').map((r) => r.slug)).toEqual([
      'frontend-edit',
    ])
    expect(roundsForSkill('identity-md', 'no-such-skill')).toEqual([])
  })
})
