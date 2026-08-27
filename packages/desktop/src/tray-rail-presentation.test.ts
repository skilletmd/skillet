import { describe, it, expect } from 'vitest'
import { resolveRailBadges } from './tray-rail-presentation'

describe('resolveRailBadges', () => {
  it('lights neither dot when nothing is pending', () => {
    expect(resolveRailBadges({ pendingCount: 0, updateReady: false })).toEqual({
      home: false,
      account: null,
    })
  })

  it('lights only the Home bell for pending skill updates', () => {
    expect(resolveRailBadges({ pendingCount: 2, updateReady: false })).toEqual({
      home: true,
      account: null,
    })
  })

  it('lights only the account dot for a waiting app update', () => {
    expect(resolveRailBadges({ pendingCount: 0, updateReady: true })).toEqual({
      home: false,
      account: 'ready',
    })
  })

  it('lights both dots independently when both signals are present', () => {
    expect(resolveRailBadges({ pendingCount: 3, updateReady: true })).toEqual({
      home: true,
      account: 'ready',
    })
  })

  it('does not light the Home bell at exactly zero pending', () => {
    // Guards against a truthiness regression (e.g. `pendingCount` instead of `> 0`).
    expect(resolveRailBadges({ pendingCount: 0, updateReady: false }).home).toBe(false)
  })

  // The account dot carries two different meanings, and they are not the same
  // colour. An update waiting to install is go: green. A permission Skillet
  // needs and does not have is a problem: amber, matching the Permissions row
  // it leads to. Rendering a blocked capability as a green "ready" dot tells
  // the user the opposite of the truth.
  it('marks a missing permission as attention, not ready', () => {
    expect(
      resolveRailBadges({ pendingCount: 0, updateReady: false, permissionsNeedAttention: true }),
    ).toEqual({ home: false, account: 'attention' })
  })

  it('lets attention outrank a waiting update', () => {
    // Both behind one dot. A blocked capability outranks an available update:
    // the update can wait, the broken thing cannot.
    expect(
      resolveRailBadges({ pendingCount: 0, updateReady: true, permissionsNeedAttention: true }),
    ).toEqual({ home: false, account: 'attention' })
  })

  it('stays truthy for either tone so dot-or-no-dot checks still work', () => {
    expect(resolveRailBadges({ pendingCount: 0, updateReady: true }).account).toBeTruthy()
    expect(
      resolveRailBadges({ pendingCount: 0, updateReady: false, permissionsNeedAttention: true })
        .account,
    ).toBeTruthy()
    expect(resolveRailBadges({ pendingCount: 0, updateReady: false }).account).toBeFalsy()
  })
})
