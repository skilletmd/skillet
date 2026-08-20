import { describe, it, expect } from 'vitest'
import type { FeedEvent } from '@/lib/registry'
import { feedEventKey, mergeFeedHead } from './feed-head-merge'

const skill = (author: string, slug: string, at: number): FeedEvent => ({
  kind: 'skill',
  type: 'published',
  actor: author,
  actorAvatarUrl: null,
  actorFollowers: 0,
  at,
  skill: {
    author,
    slug,
    description: null,
    category: null,
    installs: 0,
    scan: null,
    version: null,
    followedByYou: [],
    followedByYouCount: 0,
  },
})

describe('mergeFeedHead', () => {
  it('prepends unseen head events and updates seen', () => {
    const existing = [skill('alice', 'one', 100)]
    const seen = new Set(existing.map(feedEventKey))
    const head = [skill('bob', 'two', 200), skill('alice', 'one', 100)]
    const { prepended, merged } = mergeFeedHead(existing, head, seen)
    expect(prepended).toHaveLength(1)
    expect(prepended[0]).toMatchObject({ skill: { author: 'bob', slug: 'two' } })
    expect(merged).toHaveLength(2)
    expect(merged[0]).toBe(prepended[0])
    expect(seen.has(feedEventKey(head[0]!))).toBe(true)
  })

  it('returns the same list when head has no new events', () => {
    const existing = [skill('alice', 'one', 100)]
    const seen = new Set(existing.map(feedEventKey))
    const { prepended, merged } = mergeFeedHead(existing, [...existing], seen)
    expect(prepended).toHaveLength(0)
    expect(merged).toBe(existing)
  })

  it('dedupes load-more overlap after a prepend', () => {
    const existing = [skill('alice', 'one', 100)]
    const seen = new Set(existing.map(feedEventKey))
    const head = [skill('bob', 'two', 200)]
    mergeFeedHead(existing, head, seen)
    const loadMoreChunk = [skill('bob', 'two', 200), skill('carol', 'three', 50)]
    const fresh = loadMoreChunk.filter((e) => {
      const k = feedEventKey(e)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    expect(fresh).toHaveLength(1)
    expect(fresh[0]).toMatchObject({ skill: { author: 'carol', slug: 'three' } })
  })
})
