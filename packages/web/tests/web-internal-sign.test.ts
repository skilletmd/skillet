import { describe, it, expect } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { canonicalJson, signWebInternalHeaders } from '@/lib/web-internal-sign'

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

describe('web-internal request signer', () => {
  it('canonicalJson sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}')
    expect(canonicalJson([{ y: 1, x: 2 }])).toBe('[{"x":2,"y":1}]')
    expect(canonicalJson({ a: { y: 1, x: 2 } })).toBe('{"a":{"x":2,"y":1}}')
  })

  it('produces a stable signature matching a hand-recomputed HMAC over the canonical string', () => {
    const secret = 'sign-secret'
    const path = '/api/v1/auth/web/session'
    const body = { provider: 'google', provider_subject_id: 'x', email_verified: true }

    const h = signWebInternalHeaders({ secret, method: 'POST', path, body })

    expect(h['x-skillet-web-sig']).toMatch(/^[0-9a-f]{64}$/)
    expect(h['x-skillet-web-nonce']).toMatch(/^[0-9a-f]{32}$/)
    expect(h['x-skillet-web-ts']).toMatch(/^\d+$/)

    // Recompute the canonical string from the headers the signer chose; the HMAC
    // must match exactly (the canonical formula is the cross-package contract).
    const canonical = [
      'POST',
      sha(path), // path is hashed (no raw variable-length field)
      sha(''), // empty querystring
      sha(canonicalJson(body)),
      h['x-skillet-web-ts'],
      h['x-skillet-web-nonce'],
    ].join('\n')
    const expected = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')
    expect(h['x-skillet-web-sig']).toBe(expected)
  })

  it('a different secret yields a different signature for identical inputs', () => {
    const path = '/p'
    const body = { a: 1 }
    const h1 = signWebInternalHeaders({ secret: 's1', method: 'POST', path, body })
    // Reconstruct what s2 would have signed over h1's ts/nonce.
    const canonical = ['POST', path, sha(''), sha(canonicalJson(body)), h1['x-skillet-web-ts'], h1['x-skillet-web-nonce']].join('\n')
    const s2sig = createHmac('sha256', 's2').update(canonical, 'utf8').digest('hex')
    expect(h1['x-skillet-web-sig']).not.toBe(s2sig)
  })
})
