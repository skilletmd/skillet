import { describe, expect, it } from 'vitest'
import { isSafeUntrustedHref } from '@/components/app-link'

describe('untrusted markdown href allowlist', () => {
  it('allows http(s), mailto, relative, and hash links', () => {
    expect(isSafeUntrustedHref('https://example.com')).toBe(true)
    expect(isSafeUntrustedHref('http://localhost/x')).toBe(true)
    expect(isSafeUntrustedHref('mailto:hi@x.com')).toBe(true)
    expect(isSafeUntrustedHref('/skills')).toBe(true)
    expect(isSafeUntrustedHref('#top')).toBe(true)
  })

  it('blocks javascript and data URIs', () => {
    expect(isSafeUntrustedHref('javascript:alert(1)')).toBe(false)
    expect(isSafeUntrustedHref('data:text/html,<script>alert(1)</script>')).toBe(false)
  })
})
