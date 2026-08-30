import { describe, it, expect } from 'vitest'
import {
  safeRedirectPath,
  safeCallbackPath,
  optionalSafeCallbackPath,
} from '@/lib/auth-errors'

// Auth.js rewrites `callbackUrl` to an ABSOLUTE url whenever it bounces to a
// custom `pages.signIn` page. Dropping those sent the user to the generic
// post-login default with the real destination silently lost, which is how
// "Connect GitHub" on /settings/github ended up at /feed.
describe('same-origin absolute redirect targets', () => {
  const abs = 'https://skillet.md/settings/github?linked=github'

  it('reduces a same-origin absolute url to its path + query', () => {
    expect(optionalSafeCallbackPath(abs)).toBe('/settings/github?linked=github')
    expect(safeRedirectPath(abs)).toBe('/settings/github?linked=github')
    expect(safeCallbackPath(abs)).toBe('/settings/github?linked=github')
  })

  it('keeps the hash', () => {
    expect(optionalSafeCallbackPath('https://skillet.md/docs#install')).toBe('/docs#install')
  })

  it('a bare same-origin url reduces to /', () => {
    expect(optionalSafeCallbackPath('https://skillet.md')).toBe('/')
  })

  it('still rejects a foreign origin', () => {
    expect(optionalSafeCallbackPath('https://evil.example.com/settings')).toBeUndefined()
    expect(safeRedirectPath('https://evil.example.com/settings')).toBe('/settings')
    // A lookalike host must not pass on prefix alone.
    expect(optionalSafeCallbackPath('https://skillet.md.evil.example.com/x')).toBeUndefined()
  })

  it('still rejects the scheme-mismatched twin', () => {
    expect(optionalSafeCallbackPath('http://skillet.md/settings')).toBeUndefined()
  })

  it('same-origin absolute /login is still refused', () => {
    expect(optionalSafeCallbackPath('https://skillet.md/login')).toBeUndefined()
  })
})

describe('existing hardening is preserved', () => {
  it('rejects protocol-relative and backslash jumps', () => {
    for (const bad of ['//evil.example.com', '/\\evil.example.com', 'javascript:alert(1)']) {
      expect(optionalSafeCallbackPath(bad)).toBeUndefined()
      expect(safeRedirectPath(bad)).toBe('/settings')
    }
  })

  it('rejects control characters', () => {
    expect(optionalSafeCallbackPath('/settings\n/evil')).toBeUndefined()
  })

  it('passes plain relative paths through', () => {
    expect(optionalSafeCallbackPath('/notifications')).toBe('/notifications')
    expect(safeRedirectPath('/updates', '/fallback')).toBe('/updates')
  })

  it('empty / absent input falls back', () => {
    expect(optionalSafeCallbackPath(undefined)).toBeUndefined()
    expect(optionalSafeCallbackPath('   ')).toBeUndefined()
    expect(safeRedirectPath(undefined, '/settings/github')).toBe('/settings/github')
  })
})
