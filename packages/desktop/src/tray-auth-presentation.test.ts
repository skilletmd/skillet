import { describe, it, expect } from 'vitest'
import { isUnpairedAuth, resolveTrayAuthPresentation } from './tray-auth-presentation'

describe('resolveTrayAuthPresentation', () => {
  it('shows sign-in gate when bearer is none', () => {
    const p = resolveTrayAuthPresentation(null)
    expect(p.tier).toBe('unlinked')
    expect(p.showAccountKitGroups).toBe(false)
    expect(p.canSignOut).toBe(false)
  })

  it('treats pair-claimed device as linked when whoami is offline', () => {
    const p = resolveTrayAuthPresentation({
      bearer: { kind: 'device' },
      identity: { handle: 'thiago' },
      whoami: null,
      linked_machine: true,
    })
    expect(p.tier).toBe('linked')
    expect(p.showAccountKitGroups).toBe(true)
    expect(p.displayHandle).toBe('thiago')
  })

  it('routes device credentials that resolve to no account to the sign-in gate', () => {
    // There is no device-only tier anymore: a bearer that is not
    // registry-linked is just unlinked, and the only CTA is sign_in.
    const p = resolveTrayAuthPresentation({
      bearer: { kind: 'device' },
      identity: null,
      whoami: null,
      linked_machine: false,
    })
    expect(p.tier).toBe('unlinked')
    expect(p.showAccountKitGroups).toBe(false)
    // Sign out stays available so stale local credentials can be cleared.
    expect(p.canSignOut).toBe(true)
  })

  it('session bearer with whoami handle shows signed in', () => {
    const p = resolveTrayAuthPresentation({
      bearer: { kind: 'session' },
      identity: { handle: 'thiago' },
      whoami: { handle: 'thiago', user_id: 'u1' },
    })
    expect(p.tier).toBe('linked')
    expect(p.showAccountKitGroups).toBe(true)
    expect(p.canSignOut).toBe(true)
  })

  it('device with live whoami.user_id is linked with device label', () => {
    const p = resolveTrayAuthPresentation({
      bearer: { kind: 'device' },
      identity: { handle: 'thiago' },
      whoami: { handle: 'thiago', user_id: 'u1' },
      linked_machine: false,
    })
    expect(p.tier).toBe('linked')
  })
})

describe('resolveTrayAuthPresentation — disconnected (device revoked on web)', () => {
  const revokedMachine = {
    bearer: { kind: 'device' },
    identity: { handle: 'thiago' },
    whoami: null,
    linked_machine: true,
  }

  it('defeats the linked_machine short-circuit and routes to the gate', () => {
    const p = resolveTrayAuthPresentation(revokedMachine, { disconnected: true })
    expect(p.tier).not.toBe('linked')
    expect(p.showAccountKitGroups).toBe(false)
    expect(p.disconnected).toBe(true)
  })

  it('keeps Sign out available so local credentials can still be cleared', () => {
    const p = resolveTrayAuthPresentation(revokedMachine, { disconnected: true })
    expect(p.canSignOut).toBe(true)
  })

  it('a revoked machine presents as unlinked and disconnected', () => {
    const p = resolveTrayAuthPresentation(revokedMachine, { disconnected: true })
    expect(p.tier).toBe('unlinked')
    expect(p.disconnected).toBe(true)
  })

  it('disconnected false leaves every existing case unchanged', () => {
    const p = resolveTrayAuthPresentation(revokedMachine, { disconnected: false })
    expect(p.tier).toBe('linked')
    expect(p.showAccountKitGroups).toBe(true)
    expect(p.disconnected).toBe(false)
    const single = resolveTrayAuthPresentation(revokedMachine)
    expect(single).toEqual(p)
  })

  it('signed-out machine stays plain unlinked even if a stale flag survives', () => {
    const p = resolveTrayAuthPresentation(null, { disconnected: true })
    expect(p.tier).toBe('unlinked')
    expect(p.canSignOut).toBe(false)
  })
})

describe('resolveTrayAuthPresentation — disconnected device with no account', () => {
  it('resolves to the unlinked gate with reconnect copy', () => {
    const p = resolveTrayAuthPresentation(
      { bearer: { kind: 'device' }, identity: null, whoami: null, linked_machine: false },
      { disconnected: true },
    )
    expect(p.tier).toBe('unlinked')
    expect(p.showAccountKitGroups).toBe(false)
  })
})

describe('isUnpairedAuth — the background-poller guard', () => {
  it('no auth at all is unpaired', () => {
    expect(isUnpairedAuth(null)).toBe(true)
    expect(isUnpairedAuth(undefined)).toBe(true)
  })

  it('bearer kind none is unpaired', () => {
    expect(isUnpairedAuth({ bearer: { kind: 'none' } })).toBe(true)
    expect(isUnpairedAuth({ bearer: null })).toBe(true)
    expect(isUnpairedAuth({})).toBe(true)
  })

  it('any real bearer is NOT unpaired — even revoked machines keep polling', () => {
    // A disconnected (web-revoked) machine still has a device bearer; its
    // tray-open check must keep running so a stale sticky flag can clear.
    expect(isUnpairedAuth({ bearer: { kind: 'device' } })).toBe(false)
    expect(isUnpairedAuth({ bearer: { kind: 'session' } })).toBe(false)
  })
})
