import { describe, it, expect } from 'vitest'
import { resolvePostLoginPath } from '@/lib/post-login-redirect'

describe('resolvePostLoginPath', () => {
  it('R4: known handle-less headed for a handle-gated surface -> /settings', () => {
    expect(resolvePostLoginPath({ callbackUrl: '/notifications', hasHandle: false })).toBe(
      '/settings',
    )
    expect(resolvePostLoginPath({ callbackUrl: '/updates', hasHandle: false })).toBe('/settings')
  })

  it('handle-less headed for a NON-gated destination is left alone (not /settings)', () => {
    // The bug was only about handle-gated surfaces; /feed, profiles, skill pages
    // etc. render fine without a handle and must not be hijacked to /settings.
    expect(resolvePostLoginPath({ callbackUrl: '/feed', hasHandle: false })).toBe('/feed')
    expect(resolvePostLoginPath({ callbackUrl: '/alice', hasHandle: false })).toBe('/alice')
  })

  it('handle-less with no destination lands in the app (Feed), not /settings', () => {
    expect(resolvePostLoginPath({ hasHandle: false })).toBe('/feed')
  })

  it('honors a safe callbackUrl when the account has a handle', () => {
    expect(resolvePostLoginPath({ callbackUrl: '/notifications', hasHandle: true })).toBe(
      '/notifications',
    )
  })

  it('back-compat: without hasHandle, a safe callbackUrl is still honored', () => {
    expect(resolvePostLoginPath({ callbackUrl: '/notifications' })).toBe('/notifications')
  })

  it('unknown handle (whoami blip) does not divert — callback honored, middleware backstops', () => {
    expect(resolvePostLoginPath({ callbackUrl: '/notifications', hasHandle: undefined })).toBe(
      '/notifications',
    )
  })

  it('defaults to /feed when there is no callbackUrl and the account has a handle', () => {
    expect(resolvePostLoginPath({ callbackUrl: undefined, hasHandle: true })).toBe('/feed')
    expect(resolvePostLoginPath({})).toBe('/feed')
  })

  it('rejects an unsafe callbackUrl (falls through to /feed)', () => {
    expect(resolvePostLoginPath({ callbackUrl: '//evil.example.com', hasHandle: true })).toBe(
      '/feed',
    )
    expect(resolvePostLoginPath({ callbackUrl: '/login', hasHandle: true })).toBe('/feed')
  })
})
