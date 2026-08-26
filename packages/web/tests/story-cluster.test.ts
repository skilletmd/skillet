import { describe, expect, it } from 'vitest'
import { cluster, terms, MAX_CLUSTER, MIN_CLUSTER } from '@/lib/story-cluster.mjs'

// Clustering decides what a story is ABOUT. Getting it wrong is only visible
// after the prose is written and the tokens are spent, so the linkage rule is
// pinned here rather than discovered in a published story.

const post = (text: string, extra: Record<string, unknown> = {}) => ({
  text,
  handle: 'someone',
  likes: 10,
  match: 'none',
  skills: [],
  collections: [],
  repos: [],
  unknownSkill: null,
  ...extra,
})

describe('terms', () => {
  it('lifts resolved entities, not just words', () => {
    const t = terms(
      post('a post', {
        skills: [{ author: 'a', slug: 'animate-expo' }],
        collections: [{ repoOwner: 'emilkowalski', author: 'emilkowalski', count: 8 }],
        repos: ['emilkowalski/skills'],
      }),
    )
    expect(t.has('skill:animate-expo')).toBe(true)
    expect(t.has('owner:emilkowalski')).toBe(true)
    expect(t.has('repo:emilkowalski/skills')).toBe(true)
  })

  it('drops corpus-wide words that cannot distinguish one story from another', () => {
    const t = terms(post('skills agent claude code using build'))
    expect(t.size).toBe(0)
  })
})

describe('cluster', () => {
  it('does not chain unrelated posts through a shared middle', () => {
    // The failure this rule exists for. Single-link agglomeration joined A-B-C-D
    // when A and D shared nothing, and a real day produced one 23-post "story"
    // spanning scandi CSS, model choice and a free course.
    const chain = [
      post('kubernetes helm terraform deployment pipeline'),
      post('kubernetes helm rendering typography spacing'),
      post('typography spacing baseline vertical rhythm'),
      post('baseline vertical rhythm letterforms kerning'),
      post('letterforms kerning ligatures typeface foundry'),
      post('ligatures typeface foundry serif specimen'),
    ]
    for (const group of cluster(chain)) {
      const first = terms(group[0]!)
      const last = terms(group[group.length - 1]!)
      const shared = [...first].filter((t) => last.has(t))
      expect(shared.length).toBeGreaterThan(0)
    }
  })

  it('groups posts that genuinely share a subject', () => {
    const shared = 'discernment nudge anthropic shipped behaviour'
    const groups = cluster([
      post(`${shared} rollout announcement`),
      post(`${shared} rollout reaction`),
      post(`${shared} rollout critique`),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(3)
  })

  it('drops a group below the minimum', () => {
    const shared = 'scandinavian minimalism restyling website'
    expect(cluster([post(`${shared} one`), post(`${shared} two`)])).toEqual([])
    expect(MIN_CLUSTER).toBe(3)
  })

  it('never returns a cluster larger than the cap', () => {
    const shared = 'quantitative sportsbook modelling backtesting simulation'
    const many = Array.from({ length: MAX_CLUSTER + 6 }, (_, i) => post(`${shared} variant ${i}`))
    for (const group of cluster(many)) {
      expect(group.length).toBeLessThanOrEqual(MAX_CLUSTER)
    }
  })

  it('orders clusters by reach so the biggest story leads', () => {
    const quiet = 'kerning ligatures typeface specimen foundry'
    const loud = 'permissions sandboxing capability revocation auditing'
    const groups = cluster([
      post(`${quiet} a`, { likes: 1 }),
      post(`${quiet} b`, { likes: 1 }),
      post(`${quiet} c`, { likes: 1 }),
      post(`${loud} a`, { likes: 900 }),
      post(`${loud} b`, { likes: 900 }),
      post(`${loud} c`, { likes: 900 }),
    ])
    expect(groups.length).toBeGreaterThanOrEqual(2)
    expect(groups[0]![0]!.text).toContain('permissions')
  })

  it('returns nothing for posts with no shared subject', () => {
    expect(
      cluster([
        post('kerning ligatures typeface specimen'),
        post('kubernetes helm terraform ingress'),
        post('sportsbook modelling backtesting simulation'),
      ]),
    ).toEqual([])
  })
})
