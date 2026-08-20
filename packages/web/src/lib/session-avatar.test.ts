import { describe, it, expect } from 'vitest'
import { isDataUrl, jwtSafePicture, MAX_JWT_PICTURE_LEN } from './session-avatar'

describe('isDataUrl', () => {
  it('flags data: URLs (the legacy inline avatar that bloats the cookie)', () => {
    expect(isDataUrl('data:image/png;base64,AAAA')).toBe(true)
    expect(isDataUrl('  data:image/jpeg;base64,xyz')).toBe(true)
  })
  it('flags case/whitespace variants the browser still treats as data URIs', () => {
    expect(isDataUrl('Data:image/png;base64,AAAA')).toBe(true)
    expect(isDataUrl('DATA:image/svg+xml;base64,xyz')).toBe(true)
    expect(isDataUrl('  Data:image/png;base64,AAAA')).toBe(true)
  })
  it('does not flag real URLs, paths, empty, or non-strings', () => {
    expect(isDataUrl('https://pub-x.r2.dev/dev/abc')).toBe(false)
    expect(isDataUrl('/avatars/fox.svg?hue=200')).toBe(false)
    expect(isDataUrl('')).toBe(false)
    expect(isDataUrl(null)).toBe(false)
    expect(isDataUrl(undefined)).toBe(false)
  })
})

describe('jwtSafePicture', () => {
  it('keeps R2 URLs and site-relative preset paths', () => {
    expect(jwtSafePicture('https://pub-x.r2.dev/dev/abc')).toBe('https://pub-x.r2.dev/dev/abc')
    expect(jwtSafePicture('/avatars/fox.svg?hue=200')).toBe('/avatars/fox.svg?hue=200')
  })
  it('drops data: URLs regardless of case or leading whitespace', () => {
    expect(jwtSafePicture('data:image/png;base64,AAAA')).toBeUndefined()
    expect(jwtSafePicture('Data:image/png;base64,AAAA')).toBeUndefined()
    expect(jwtSafePicture('  DATA:image/png;base64,AAAA')).toBeUndefined()
  })
  it('drops an over-long value (cookie-bloat guard for non-data URLs)', () => {
    expect(jwtSafePicture('https://x.test/' + 'a'.repeat(MAX_JWT_PICTURE_LEN))).toBeUndefined()
  })
  it('drops empty, whitespace, and non-strings', () => {
    expect(jwtSafePicture('')).toBeUndefined()
    expect(jwtSafePicture('   ')).toBeUndefined()
    expect(jwtSafePicture(null)).toBeUndefined()
    expect(jwtSafePicture(42)).toBeUndefined()
  })
  it('trims surrounding whitespace on a kept value', () => {
    expect(jwtSafePicture('  https://x.test/a  ')).toBe('https://x.test/a')
  })
})
