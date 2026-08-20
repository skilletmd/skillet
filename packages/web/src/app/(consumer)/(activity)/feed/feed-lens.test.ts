import { describe, expect, it } from 'vitest'
import { parseFeedSection, feedPathState, parseLens, isFeedLensSegment } from './feed-lens'

describe('parseFeedSection', () => {
  it('resolves /feed and its lenses to the activity section', () => {
    expect(parseFeedSection('/feed')).toBe('activity')
    expect(parseFeedSection('/feed/global')).toBe('activity')
    expect(parseFeedSection('/feed/team/acme')).toBe('activity')
  })

  it('resolves the top-level notifications and updates destinations', () => {
    expect(parseFeedSection('/notifications')).toBe('notifications')
    expect(parseFeedSection('/updates')).toBe('updates')
  })
})

describe('feedPathState', () => {
  it('treats bare /feed as no explicit lens (For you default)', () => {
    expect(feedPathState('/feed')).toEqual({ lens: undefined })
  })

  it('reads the global lens and team slug from the path', () => {
    expect(feedPathState('/feed/global')).toEqual({ lens: 'global' })
    expect(feedPathState('/feed/team/acme')).toEqual({ lens: 'team', teamSlug: 'acme' })
  })
})

describe('isFeedLensSegment (the /feed/[lens] guard + URL cutover)', () => {
  it('accepts only the global lens segment', () => {
    expect(isFeedLensSegment('global')).toBe(true)
  })

  it('rejects the retired segments so old URLs 404', () => {
    expect(isFeedLensSegment('foryou')).toBe(false)
    expect(isFeedLensSegment('discover')).toBe(false)
    expect(isFeedLensSegment('notifications')).toBe(false)
    expect(isFeedLensSegment('updates')).toBe(false)
    expect(isFeedLensSegment(undefined)).toBe(false)
  })
})

describe('parseLens', () => {
  it('maps global to the discover view', () => {
    expect(parseLens('global', true)).toBe('discover')
    expect(parseLens('global', false)).toBe('discover')
  })

  it('defaults an authed viewer with no lens to following', () => {
    expect(parseLens(undefined, true)).toBe('following')
    expect(parseLens(undefined, false)).toBe('discover')
  })
})
