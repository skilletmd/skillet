import { describe, it, expect } from 'vitest'
import {
  profileHref,
  skillHref,
  skillEditHref,
  skillProposeHref,
  skillReviewHref,
  authorKitHref,
  kitHref,
  kitHrefFromRecord,
} from '@/lib/urls'

describe('owner-namespaced URL helpers', () => {
  it('builds profile and skill paths owner-first', () => {
    expect(profileHref('maya-writes')).toBe('/maya-writes')
    expect(skillHref('maya-writes', 'festival-ops')).toBe('/maya-writes/festival-ops')
    expect(skillEditHref('maya-writes', 'festival-ops')).toBe('/maya-writes/festival-ops/edit')
    expect(skillProposeHref('maya-writes', 'festival-ops')).toBe('/maya-writes/festival-ops/propose')
  })

  it('builds review hrefs with and without a proposal id', () => {
    expect(skillReviewHref('maya-writes', 'festival-ops')).toBe('/maya-writes/festival-ops/review')
    expect(skillReviewHref('maya-writes', 'festival-ops', 'abc 123')).toBe(
      '/maya-writes/festival-ops/review?proposal=abc%20123',
    )
  })

  it('nests kits under the reserved kit/ segment', () => {
    expect(authorKitHref('maya-writes')).toBe('/maya-writes/kit')
    expect(kitHref('maya-writes', 'writers-room')).toBe('/maya-writes/kit/writers-room')
  })

  it('prefers the slug permalink from a kit record', () => {
    expect(kitHrefFromRecord({ owner: 'maya-writes', slug: 'writers-room', id: 'uuid-1' })).toBe(
      '/maya-writes/kit/writers-room',
    )
  })

  it('falls back to the legacy UUID path when owner or slug is missing', () => {
    expect(kitHrefFromRecord({ id: 'uuid-1' })).toBe('/kits/uuid-1')
    expect(kitHrefFromRecord({ owner: 'maya-writes', slug: null, id: 'uuid-1' })).toBe('/kits/uuid-1')
    expect(kitHrefFromRecord({ owner: null, slug: 'writers-room', id: 'uuid-1' })).toBe('/kits/uuid-1')
  })
})
