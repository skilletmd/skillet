import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isSafeUntrustedHref } from '../src/untrusted-href.js'

describe('isSafeUntrustedHref', () => {
  it('allows http, https, and mailto', () => {
    assert.equal(isSafeUntrustedHref('http://example.com'), true)
    assert.equal(isSafeUntrustedHref('https://example.com/path?q=1#h'), true)
    assert.equal(isSafeUntrustedHref('mailto:hi@example.com'), true)
  })

  it('allows same-origin routes and in-page hashes', () => {
    assert.equal(isSafeUntrustedHref('/skills/foo'), true)
    assert.equal(isSafeUntrustedHref('#section'), true)
  })

  it('rejects empty and whitespace-only hrefs', () => {
    assert.equal(isSafeUntrustedHref(''), false)
    assert.equal(isSafeUntrustedHref('   '), false)
  })

  // Covers AE6 — a hostile scheme returns unsafe.
  it('rejects hostile schemes', () => {
    assert.equal(isSafeUntrustedHref('javascript:alert(1)'), false)
    assert.equal(isSafeUntrustedHref('data:text/html,<script>alert(1)</script>'), false)
    assert.equal(isSafeUntrustedHref('vbscript:msgbox(1)'), false)
    assert.equal(isSafeUntrustedHref('file:///etc/passwd'), false)
  })

  it('rejects protocol-relative URLs (foreign origin)', () => {
    assert.equal(isSafeUntrustedHref('//evil.com'), false)
    assert.equal(isSafeUntrustedHref('  //evil.com'), false)
  })

  it('rejects whitespace- and case-obfuscated schemes', () => {
    assert.equal(isSafeUntrustedHref(' JavaScript:alert(1)'), false)
    assert.equal(isSafeUntrustedHref('JAVASCRIPT:alert(1)'), false)
    assert.equal(isSafeUntrustedHref('\tjavascript:alert(1)'), false)
    assert.equal(isSafeUntrustedHref('java\tscript:alert(1)'), false)
  })
})
