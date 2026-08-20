import { describe, it, expect } from 'vitest'
import { authErrorMessage, optionalSafeCallbackPath, safeCallbackPath, safeRedirectPath } from '@/lib/auth-errors'

describe('authErrorMessage', () => {
  it('returns null when no error code', () => {
    expect(authErrorMessage(undefined)).toBeNull()
  })

  it('maps OAuthAccountNotLinked', () => {
    expect(authErrorMessage('OAuthAccountNotLinked')).toMatch(/different sign-in method/)
  })

  it('falls back for unknown codes', () => {
    expect(authErrorMessage('SomethingNew')).toMatch(/Something went wrong/)
  })

  it('maps magic-link errors', () => {
    expect(authErrorMessage('MagicLinkInvalid')).toMatch(/invalid or expired/)
    expect(authErrorMessage('MagicLinkMissing')).toMatch(/incomplete/)
  })
})

describe('safeCallbackPath', () => {
  it('defaults to account settings', () => {
    expect(safeCallbackPath(undefined)).toBe('/settings')
  })

  it('rejects external URLs', () => {
    expect(safeCallbackPath('https://evil.test')).toBe('/settings')
    expect(safeCallbackPath('//evil.test/path')).toBe('/settings')
  })

  it('rejects backslash-based protocol-relative redirects', () => {
    // Browsers treat /\evil.com as a jump to an external host.
    expect(safeCallbackPath('/\\evil.com')).toBe('/settings')
    expect(safeCallbackPath('/\\\\evil.com')).toBe('/settings')
  })

  it('rejects paths containing control characters', () => {
    expect(safeCallbackPath('/foo\nbar')).toBe('/settings')
    expect(safeCallbackPath('/foo\x00bar')).toBe('/settings')
  })

  it('allows same-origin paths', () => {
    expect(safeCallbackPath('/settings/teams')).toBe('/settings/teams')
  })
})

describe('optionalSafeCallbackPath', () => {
  it('returns undefined for absent or unsafe paths', () => {
    expect(optionalSafeCallbackPath(undefined)).toBeUndefined()
    expect(optionalSafeCallbackPath('//evil.test')).toBeUndefined()
    expect(optionalSafeCallbackPath('/\\evil.com')).toBeUndefined()
  })

  it('returns explicit safe paths', () => {
    expect(optionalSafeCallbackPath('/grace')).toBe('/grace')
  })
})

describe('safeRedirectPath', () => {
  it('honors a custom fallback', () => {
    expect(safeRedirectPath(undefined, '/settings/github')).toBe('/settings/github')
    expect(safeRedirectPath('/\\evil.com', '/settings/github')).toBe('/settings/github')
  })

  it('returns a valid same-origin path unchanged', () => {
    expect(safeRedirectPath('/settings/github?x=1', '/settings/github')).toBe('/settings/github?x=1')
  })
})
