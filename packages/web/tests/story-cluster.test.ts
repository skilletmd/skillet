import { describe, expect, it } from 'vitest'
import {
  cluster,
  normalizeHandles,
  storyCandidates,
  terms,
  MAX_CLUSTER,
} from '@/lib/story-cluster.mjs'

// Clustering decides what a story is ABOUT. Getting it wrong is only visible
// after the prose is written and the tokens are spent, so the linkage rule is
// pinned here rather than discovered in a published story.

const post = (text: string, extra: Record<string, unknown> = {}) => ({
  text,
  isSkill: false,
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
    // spanning scandi CSS, model choice, and a free course.
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
      if (group.length > 1) expect(shared.length).toBeGreaterThan(0)
    }
  })

  it('groups posts about the same event', () => {
    const shared = 'discernment nudge anthropic shipped behaviour rollout'
    const groups = cluster([post(`${shared} one`), post(`${shared} two`)])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(2)
  })

  it('keeps a lone post as its own story', () => {
    // Every post is a story now. Six unrelated releases used to group into one
    // body that listed all six, which is a list, and a reader skips a list.
    expect(cluster([post('kerning ligatures typeface specimen foundry')])).toHaveLength(1)
  })

  it('leaves posts with no shared subject ungrouped rather than merged', () => {
    const groups = cluster([
      post('kerning ligatures typeface specimen'),
      post('kubernetes helm terraform ingress'),
      post('sportsbook modelling backtesting simulation'),
    ])
    expect(groups).toHaveLength(3)
    expect(groups.every((g) => g.length === 1)).toBe(true)
  })

  it('never returns a cluster larger than the cap', () => {
    const shared = 'quantitative sportsbook modelling backtesting simulation walkforward'
    const many = Array.from({ length: MAX_CLUSTER + 6 }, (_, i) => post(`${shared} variant ${i}`))
    for (const group of cluster(many)) {
      expect(group.length).toBeLessThanOrEqual(MAX_CLUSTER)
    }
  })
})

describe('storyCandidates', () => {
  it('ranks by the loudest post, not by summed reach', () => {
    // Otherwise a three-source cluster of quiet posts outranks a bigger single
    // one on arithmetic alone, and the day leads with the wrong story.
    const quiet = 'kerning ligatures typeface specimen foundry letterforms'
    const groups = storyCandidates(
      [
        post(`${quiet} a`, { likes: 400 }),
        post(`${quiet} b`, { likes: 400 }),
        post(`${quiet} c`, { likes: 400 }),
        post('permissions sandboxing capability revocation auditing', { likes: 900 }),
      ],
      { skills: 5, news: 5 },
    )
    expect(groups[0]![0]!.text).toContain('permissions')
  })

  it('ranks the two queues separately so skills cannot crowd out news', () => {
    // In one pool skill posts out-like news posts, and a real day produced
    // fourteen skills and zero news: the brief lost half its subject matter.
    const loudSkill = (i: number) =>
      post(`installable packaged distribution variant ${i} shipped`, { isSkill: true, likes: 900 })
    const quietNews = post('permissions sandboxing capability revocation auditing', { likes: 5 })
    const groups = storyCandidates([...Array.from({ length: 6 }, (_, i) => loudSkill(i)), quietNews], {
      skills: 2,
      news: 2,
    })
    expect(groups.some((g) => g[0]!.text.includes('permissions'))).toBe(true)
    expect(groups.filter((g) => g[0]!.isSkill)).toHaveLength(2)
  })

  it('caps each queue at its own limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => post(`unrelated subject number ${i} here`))
    expect(storyCandidates(many, { skills: 8, news: 8 })).toHaveLength(8)
  })
})

describe('normalizeHandles', () => {
  const sources = [{ handle: 'rohanpaul_ai' }, { handle: 'MiaAI_lab' }, { handle: 'j_maffe' }]

  it('prefixes a bare handle and leaves an @-prefixed one alone', () => {
    expect(normalizeHandles('rohanpaul_ai relayed it. @MiaAI_lab agreed.', sources)).toBe(
      '@rohanpaul_ai relayed it. @MiaAI_lab agreed.',
    )
  })

  it('leaves domains and URL paths alone', () => {
    // The naive \\b guard matched before the dot and produced "@rohanpaul_ai.com".
    expect(normalizeHandles('see rohanpaul_ai.com and x.com/j_maffe', sources)).toBe(
      'see rohanpaul_ai.com and x.com/j_maffe',
    )
  })

  it('still prefixes a handle that ends a sentence', () => {
    expect(normalizeHandles('credit goes to j_maffe.', sources)).toBe('credit goes to @j_maffe.')
  })

  it('does not match a handle inside a longer token', () => {
    expect(normalizeHandles('j_maffe_two is someone else', sources)).toBe(
      'j_maffe_two is someone else',
    )
  })

  it('ignores sources with no handle', () => {
    expect(normalizeHandles('nothing to do', [{ handle: null }])).toBe('nothing to do')
  })
})
