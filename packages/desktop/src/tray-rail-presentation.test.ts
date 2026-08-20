import { describe, it, expect } from 'vitest'
import { resolveRailBadges } from './tray-rail-presentation'

describe('resolveRailBadges', () => {
  it('lights neither dot when nothing is pending', () => {
    expect(resolveRailBadges({ pendingCount: 0, updateReady: false })).toEqual({
      home: false,
      account: false,
    })
  })

  it('lights only the Home bell for pending skill updates', () => {
    expect(resolveRailBadges({ pendingCount: 2, updateReady: false })).toEqual({
      home: true,
      account: false,
    })
  })

  it('lights only the account dot for a waiting app update', () => {
    expect(resolveRailBadges({ pendingCount: 0, updateReady: true })).toEqual({
      home: false,
      account: true,
    })
  })

  it('lights both dots independently when both signals are present', () => {
    expect(resolveRailBadges({ pendingCount: 3, updateReady: true })).toEqual({
      home: true,
      account: true,
    })
  })

  it('does not light the Home bell at exactly zero pending', () => {
    // Guards against a truthiness regression (e.g. `pendingCount` instead of `> 0`).
    expect(resolveRailBadges({ pendingCount: 0, updateReady: false }).home).toBe(false)
  })
})
