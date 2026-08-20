import { describe, expect, it } from 'vitest'
import { handleAliasTarget } from './handle-alias'

describe('handleAliasTarget', () => {
  it('maps a bare @handle to the profile path', () => {
    expect(handleAliasTarget('/@openclaudia')).toBe('/openclaudia')
  })

  it('maps @handle/skill to the skill path', () => {
    expect(handleAliasTarget('/@openclaudia/seo-audit')).toBe('/openclaudia/seo-audit')
  })

  it('keeps deeper segments, so kit URLs alias too', () => {
    expect(handleAliasTarget('/@garrytan/kit/gstack')).toBe('/garrytan/kit/gstack')
  })

  it('accepts the percent-encoded @ some clients send', () => {
    expect(handleAliasTarget('/%40openclaudia/seo-audit')).toBe('/openclaudia/seo-audit')
  })

  it('leaves non-@ paths alone', () => {
    expect(handleAliasTarget('/openclaudia/seo-audit')).toBeNull()
    expect(handleAliasTarget('/browse')).toBeNull()
    expect(handleAliasTarget('/')).toBeNull()
  })

  it('leaves a handle-less @ alone rather than redirecting to root', () => {
    expect(handleAliasTarget('/@')).toBeNull()
    expect(handleAliasTarget('/@/seo-audit')).toBeNull()
  })
})
