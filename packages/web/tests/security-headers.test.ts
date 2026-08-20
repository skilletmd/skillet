import { describe, it, expect } from 'vitest'
import {
  buildCspValue,
  buildSecurityHeaders,
  resolveCspMode,
} from '@/lib/security-headers'

function cspOf(headers: { key: string; value: string }[]): string | undefined {
  return headers.find(
    (h) => h.key === 'Content-Security-Policy' || h.key === 'Content-Security-Policy-Report-Only',
  )?.value
}

describe('resolveCspMode', () => {
  it('passes through valid values', () => {
    expect(resolveCspMode('off')).toBe('off')
    expect(resolveCspMode('enforce')).toBe('enforce')
    expect(resolveCspMode('report-only')).toBe('report-only')
  })
  it('clamps unknown/unset to report-only (safe default)', () => {
    expect(resolveCspMode(undefined)).toBe('report-only')
    expect(resolveCspMode('garbage')).toBe('report-only')
    expect(resolveCspMode('ENFORCE')).toBe('report-only')
  })
})

describe('buildSecurityHeaders — mode → header name', () => {
  it('enforce → Content-Security-Policy', () => {
    const h = buildSecurityHeaders({ mode: 'enforce', isDev: false })
    expect(h.some((x) => x.key === 'Content-Security-Policy')).toBe(true)
    expect(h.some((x) => x.key === 'Content-Security-Policy-Report-Only')).toBe(false)
  })
  it('report-only → Content-Security-Policy-Report-Only', () => {
    const h = buildSecurityHeaders({ mode: 'report-only', isDev: false })
    expect(h.some((x) => x.key === 'Content-Security-Policy-Report-Only')).toBe(true)
    expect(h.some((x) => x.key === 'Content-Security-Policy')).toBe(false)
  })
  it('off → no CSP header, companion headers still present', () => {
    const h = buildSecurityHeaders({ mode: 'off', isDev: false })
    expect(cspOf(h)).toBeUndefined()
    expect(h.some((x) => x.key === 'X-Content-Type-Options' && x.value === 'nosniff')).toBe(true)
    expect(h.some((x) => x.key === 'Referrer-Policy')).toBe(true)
    expect(h.some((x) => x.key === 'X-Frame-Options' && x.value === 'DENY')).toBe(true)
  })
  it('companion headers present in every mode', () => {
    for (const mode of ['off', 'report-only', 'enforce'] as const) {
      const keys = buildSecurityHeaders({ mode, isDev: false }).map((x) => x.key)
      expect(keys).toContain('X-Content-Type-Options')
      expect(keys).toContain('Referrer-Policy')
      expect(keys).toContain('X-Frame-Options')
    }
  })
})

describe('buildCspValue — directives', () => {
  const prod = buildCspValue({ isDev: false })
  const dev = buildCspValue({ isDev: true })

  it('includes the high-value whole-class directives', () => {
    expect(prod).toContain("default-src 'self'")
    expect(prod).toContain("object-src 'none'")
    expect(prod).toContain("base-uri 'self'")
    expect(prod).toContain("frame-ancestors 'none'")
    expect(prod).toContain("form-action 'self'")
  })

  it('img-src allows https images (user markdown embeds external images) + self/data/blob', () => {
    expect(prod).toMatch(/img-src 'self' data: blob: https:(;|$)/)
    // no broad wildcard host source anywhere in the policy
    expect(prod).not.toMatch(/(^|\s)\*(\s|;|$)/)
    expect(prod).not.toContain('https://*')
  })

  it('connect-src is self + read-only GitHub hosts in prod; dev adds websockets', () => {
    // Scoped exception to same-origin for the client-side "import from GitHub" flow.
    expect(prod).toMatch(
      /connect-src 'self' https:\/\/api\.github\.com https:\/\/raw\.githubusercontent\.com(;|$)/,
    )
    expect(prod).not.toContain('ws:')
    expect(dev).toContain('ws:')
    expect(dev).toContain('wss:')
  })

  it('production has upgrade-insecure-requests and no unsafe-eval; dev is the opposite', () => {
    expect(prod).toContain('upgrade-insecure-requests')
    expect(prod).not.toContain("'unsafe-eval'")
    expect(dev).not.toContain('upgrade-insecure-requests')
    expect(dev).toContain("'unsafe-eval'")
  })

  it('script-src allowlists Cloudflare Web Analytics beacon in production', () => {
    expect(prod).toContain('https://static.cloudflareinsights.com')
    expect(prod).not.toMatch(/(^|\s)\*(\s|;|$)/)
  })
})
