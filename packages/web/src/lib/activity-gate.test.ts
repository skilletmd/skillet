import { describe, it, expect } from 'vitest'
import { activityGateTarget, hasClaimedHandle, isHandleGatedPath } from '@/lib/activity-gate'

describe('isHandleGatedPath', () => {
  it('matches the gated surfaces and nothing else', () => {
    expect(isHandleGatedPath('/notifications')).toBe(true)
    expect(isHandleGatedPath('/updates')).toBe(true)
    expect(isHandleGatedPath('/feed')).toBe(false)
    expect(isHandleGatedPath('/')).toBe(false)
    expect(isHandleGatedPath('/settings')).toBe(false)
  })

  it('ignores query/hash so a callbackUrl with params still matches', () => {
    expect(isHandleGatedPath('/notifications?x=1')).toBe(true)
    expect(isHandleGatedPath('/updates#top')).toBe(true)
  })

  it('does not match sub-paths', () => {
    expect(isHandleGatedPath('/notifications/thread')).toBe(false)
  })
})

describe('hasClaimedHandle', () => {
  it('is true only for a non-blank string handle', () => {
    expect(hasClaimedHandle('alice')).toBe(true)
    expect(hasClaimedHandle('')).toBe(false)
    expect(hasClaimedHandle('   ')).toBe(false)
    expect(hasClaimedHandle(null)).toBe(false)
    expect(hasClaimedHandle(undefined)).toBe(false)
  })
})

describe('activityGateTarget', () => {
  it('R1: signed-in session with no handle -> /settings (both surfaces)', () => {
    expect(activityGateTarget('/notifications', { handle: null })).toBe('/settings')
    expect(activityGateTarget('/updates', { handle: null })).toBe('/settings')
    expect(activityGateTarget('/notifications', { handle: '' })).toBe('/settings')
    expect(activityGateTarget('/notifications', {})).toBe('/settings')
  })

  it('R2: logged out -> /login carrying the requested path as callbackUrl', () => {
    expect(activityGateTarget('/notifications', null)).toBe('/login?callbackUrl=%2Fnotifications')
    expect(activityGateTarget('/updates', undefined)).toBe('/login?callbackUrl=%2Fupdates')
  })

  it('R3: signed-in session with a handle -> null (through)', () => {
    expect(activityGateTarget('/notifications', { handle: 'alice' })).toBeNull()
    expect(activityGateTarget('/updates', { handle: 'alice' })).toBeNull()
  })

  it('R5: non-gated paths are never intercepted', () => {
    expect(activityGateTarget('/feed', null)).toBeNull()
    expect(activityGateTarget('/feed', { handle: null })).toBeNull()
    expect(activityGateTarget('/', { handle: null })).toBeNull()
    expect(activityGateTarget('/settings', { handle: null })).toBeNull()
  })

  it('does not match sub-paths or trailing slashes (matcher stays exact)', () => {
    expect(activityGateTarget('/notifications/', { handle: null })).toBeNull()
    expect(activityGateTarget('/notifications/thread', { handle: null })).toBeNull()
  })

  it('treats a whitespace-only handle as unclaimed', () => {
    expect(activityGateTarget('/notifications', { handle: '   ' })).toBe('/settings')
  })
})
