import { describe, it, expect } from 'vitest'
import { blogHref, loginHref } from '@/lib/urls'

describe('blogHref', () => {
  it('returns the blog index when no slug is given', () => {
    expect(blogHref()).toBe('/blog')
  })

  it('returns a post path for a slug', () => {
    expect(blogHref('what-a-skill-buys-you')).toBe('/blog/what-a-skill-buys-you')
  })

  it('encodes a slug so a canonical can never escape /blog/', () => {
    // Stored slugs are validated on write, but this helper also feeds the
    // canonical tag from a raw route param — and a canonical is a strong signal
    // to hand a crawler. Encoding is a no-op for real slugs.
    expect(blogHref('../settings')).toBe('/blog/..%2Fsettings')
    expect(blogHref('/etc')).toBe('/blog/%2Fetc')
  })
})

describe('loginHref', () => {
  it('returns the bare /login page when no destination is given', () => {
    expect(loginHref()).toBe('/login')
  })

  it('encodes a simple profile path into the callbackUrl param', () => {
    expect(loginHref('/grace')).toBe('/login?callbackUrl=%2Fgrace')
  })

  it('fully percent-encodes paths with special characters', () => {
    expect(loginHref('/a b?x=1')).toBe('/login?callbackUrl=%2Fa%20b%3Fx%3D1')
  })

  it('round-trips: the value the follow button passes decodes back to the original path', () => {
    const href = loginHref('/grace')
    const callbackUrl = new URL(href, 'https://example.com').searchParams.get('callbackUrl')
    expect(callbackUrl).toBe('/grace')
  })
})
