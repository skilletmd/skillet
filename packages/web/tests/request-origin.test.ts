import { describe, expect, it } from 'vitest'
import { isCrossOriginPost } from '@/lib/request-origin'

const URL_UNDER_TEST = 'https://skillet.md/api/auth/login-code/verify'

function post(headers: Record<string, string>): Request {
  return new Request(URL_UNDER_TEST, { method: 'POST', headers })
}

describe('login-code verify cross-origin guard', () => {
  it('allows our own same-origin confirm-form POST (Sec-Fetch-Site)', () => {
    expect(isCrossOriginPost(post({ 'sec-fetch-site': 'same-origin' }))).toBe(false)
  })

  it('rejects a cross-site auto-POST (Sec-Fetch-Site)', () => {
    expect(isCrossOriginPost(post({ 'sec-fetch-site': 'cross-site' }))).toBe(true)
  })

  it('rejects same-site and none (never our confirm form on a POST)', () => {
    expect(isCrossOriginPost(post({ 'sec-fetch-site': 'same-site' }))).toBe(true)
    expect(isCrossOriginPost(post({ 'sec-fetch-site': 'none' }))).toBe(true)
  })

  it('Sec-Fetch-Site takes precedence over a matching Origin', () => {
    // Even with a same-origin Origin header, a cross-site fetch signal wins.
    expect(
      isCrossOriginPost(post({ 'sec-fetch-site': 'cross-site', origin: 'https://skillet.md' })),
    ).toBe(true)
  })

  it('falls back to Origin vs host when Sec-Fetch-Site is absent (older Safari)', () => {
    expect(isCrossOriginPost(post({ origin: 'https://skillet.md' }))).toBe(false)
    expect(isCrossOriginPost(post({ origin: 'https://evil.example' }))).toBe(true)
  })

  it('rejects an opaque `null` Origin', () => {
    expect(isCrossOriginPost(post({ origin: 'null' }))).toBe(true)
  })

  it('fails open when neither Origin nor Sec-Fetch-Site is present', () => {
    // Some privacy proxies strip both; sign-in must not lock those users out.
    expect(isCrossOriginPost(post({}))).toBe(false)
  })
})
