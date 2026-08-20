import { afterEach, describe, expect, it, vi } from 'vitest'
import { isOptimizableImageHost } from '@/lib/image-hosts'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isOptimizableImageHost', () => {
  it('optimizes the exact avatar hosts our logins return', () => {
    expect(isOptimizableImageHost('https://avatars.githubusercontent.com/u/9919?v=4')).toBe(true)
    expect(isOptimizableImageHost('https://lh3.googleusercontent.com/a/avatar')).toBe(true)
    expect(isOptimizableImageHost('https://pbs.twimg.com/profile_images/1/x_normal.jpg')).toBe(true)
    expect(isOptimizableImageHost('https://github.com/grace.png')).toBe(true)
  })

  it('optimizes the configured avatar bucket, and nothing when it is unset', () => {
    const uploaded = 'https://pub-test.r2.dev/avatars/abc.webp'
    // Unset is the default: uploaded avatars fall back to `unoptimized`.
    expect(isOptimizableImageHost(uploaded)).toBe(false)
    vi.stubEnv('NEXT_PUBLIC_AVATAR_BUCKET_HOST', 'pub-test.r2.dev')
    expect(isOptimizableImageHost(uploaded)).toBe(true)
    // A look-alike suffix must not match the configured bucket.
    expect(isOptimizableImageHost('https://pub-test.r2.dev.evil.test/x.webp')).toBe(false)
  })

  it('accepts the avatar bucket as a full URL and ignores a malformed value', () => {
    vi.stubEnv('NEXT_PUBLIC_AVATAR_BUCKET_HOST', 'https://pub-test.r2.dev/')
    expect(isOptimizableImageHost('https://pub-test.r2.dev/avatars/abc.webp')).toBe(true)
    vi.stubEnv('NEXT_PUBLIC_AVATAR_BUCKET_HOST', '   ')
    expect(isOptimizableImageHost('https://pub-test.r2.dev/avatars/abc.webp')).toBe(false)
  })

  it('does NOT optimize broad/non-avatar hosts (open-proxy surface)', () => {
    // Arbitrary repo files — dropped from the allowlist to avoid amplification.
    expect(isOptimizableImageHost('https://raw.githubusercontent.com/o/r/main/a.png')).toBe(false)
    expect(isOptimizableImageHost('https://github.com/evil/org/blob/main/secret.png')).toBe(false)
    // Other googleusercontent subdomains (Drive/Blogger/etc.) are not lh3.
    expect(isOptimizableImageHost('https://lh5.googleusercontent.com/a/x')).toBe(false)
    expect(isOptimizableImageHost('https://drive.googleusercontent.com/x')).toBe(false)
    // Gravatar isn't an avatar source here.
    expect(isOptimizableImageHost('https://gravatar.com/avatar/abc')).toBe(false)
  })

  it('does NOT optimize arbitrary or look-alike hosts', () => {
    expect(isOptimizableImageHost('https://example.com/me.jpg')).toBe(false)
    expect(isOptimizableImageHost('https://notgithub.com/grace.png')).toBe(false)
    expect(isOptimizableImageHost('https://lh3.googleusercontent.com.evil.test/x')).toBe(false)
    expect(isOptimizableImageHost('https://evil-pbs.twimg.com.attacker.test/x')).toBe(false)
  })

  it('passes SVGs through unoptimized even on an allowlisted host (optimizer 400s SVG)', () => {
    expect(isOptimizableImageHost('https://github.com/org/logo.svg')).toBe(false)
    expect(isOptimizableImageHost('https://avatars.githubusercontent.com/u/1/logo.SVG')).toBe(false)
  })

  it('returns false for data URLs, null, undefined, and malformed input', () => {
    expect(isOptimizableImageHost('data:image/png;base64,iVBORw0KGgo=')).toBe(false)
    // Case/whitespace variants the browser still treats as data URIs.
    expect(isOptimizableImageHost('Data:image/svg+xml;base64,iVBORw0KGgo=')).toBe(false)
    expect(isOptimizableImageHost('  DATA:image/png;base64,iVBORw0KGgo=')).toBe(false)
    expect(isOptimizableImageHost(null)).toBe(false)
    expect(isOptimizableImageHost(undefined)).toBe(false)
    expect(isOptimizableImageHost('not a url')).toBe(false)
  })
})
