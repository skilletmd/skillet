import { describe, expect, it } from 'vitest'
import { resolvePostLoginPath } from '@/lib/post-login-redirect'

describe('resolvePostLoginPath', () => {
  it('uses a safe callbackUrl when present', () => {
    expect(
      resolvePostLoginPath({
        callbackUrl: '/grace',
      }),
    ).toBe('/grace')
  })

  it('rejects unsafe callbackUrl and falls back to the feed', () => {
    expect(
      resolvePostLoginPath({
        callbackUrl: '//evil.test',
      }),
    ).toBe('/feed')
  })

  it('sends users without a callback to the feed', () => {
    expect(resolvePostLoginPath({})).toBe('/feed')
  })
})
