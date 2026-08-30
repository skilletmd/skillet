import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { register } from '@/instrumentation'

const ENV_KEYS = [
  'NEXT_RUNTIME',
  'AUTH_GITHUB_ID',
  'AUTH_GITHUB_SECRET',
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  'AUTH_GOOGLE_ID',
  'AUTH_GOOGLE_SECRET',
] as const

describe('register (auth provider boot check)', () => {
  let saved: Record<string, string | undefined>
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
    for (const k of ENV_KEYS) delete process.env[k]
    process.env.NEXT_RUNTIME = 'nodejs'
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    warn.mockRestore()
  })

  it('warns for each provider that has no credentials', () => {
    register()
    expect(warn).toHaveBeenCalledOnce()
    const msg = String(warn.mock.calls[0]?.[0])
    expect(msg).toContain('GitHub')
    expect(msg).toContain('Google')
  })

  it('stays quiet when everything is configured', () => {
    process.env.AUTH_GITHUB_ID = 'gh-id'
    process.env.AUTH_GITHUB_SECRET = 'gh-secret'
    process.env.AUTH_GOOGLE_ID = 'g-id'
    process.env.AUTH_GOOGLE_SECRET = 'g-secret'
    register()
    expect(warn).not.toHaveBeenCalled()
  })

  // The near-miss that actually shipped: credentials present under the name
  // Auth.js does NOT read must still warn.
  it('warns when GitHub creds are under the wrong env names', () => {
    process.env.AUTH_GOOGLE_ID = 'g-id'
    process.env.AUTH_GOOGLE_SECRET = 'g-secret'
    process.env.AUTH_GITHUB_CLIENT_ID = 'gh-id'
    process.env.AUTH_GITHUB_CLIENT_SECRET = 'gh-secret'
    register()
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0]?.[0])).toContain('GitHub')
    delete process.env.AUTH_GITHUB_CLIENT_ID
    delete process.env.AUTH_GITHUB_CLIENT_SECRET
  })

  it('does nothing outside the node runtime', () => {
    process.env.NEXT_RUNTIME = 'edge'
    register()
    expect(warn).not.toHaveBeenCalled()
  })
})
