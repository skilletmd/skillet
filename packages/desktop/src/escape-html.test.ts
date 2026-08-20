import { describe, it, expect } from 'vitest'
import { escapeHtml } from './escape-html'

// Tray views assign escapeHtml(...)-built strings into innerHTML, so untrusted
// fields must be HTML-escaped.
describe('escapeHtml', () => {
  it('covers all five metacharacters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('neutralizes markup so no live tag can form', () => {
    const out = escapeHtml('<img src=x onerror=alert(1)>.md')
    expect(out).not.toContain('<img')
    expect(out).not.toContain('<')
    expect(out).toContain('&lt;img')
  })

  it('passes safe text through unchanged', () => {
    expect(escapeHtml('src/config.ts:9, token')).toBe('src/config.ts:9, token')
  })
})
