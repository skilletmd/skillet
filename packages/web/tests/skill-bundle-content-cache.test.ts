import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { getSkillBundleContent } from '@/lib/skill-bundle-content'

// Anonymous skill-bundle reads must be no-store so a revoked/unpublished skill
// is never served from a stale cache.
describe('skill-bundle anonymous cache mode', () => {
  const prev = process.env.REGISTRY_URL

  beforeEach(() => {
    process.env.REGISTRY_URL = 'https://reg.example'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.REGISTRY_URL = prev
  })

  it('fetches the manifest with cache: no-store (no revalidate window)', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) })
    vi.stubGlobal('fetch', f)

    await getSkillBundleContent('alice', 'demo') // anonymous (no withSession)

    expect(f).toHaveBeenCalled()
    const opts = f.mock.calls[0][1] as RequestInit & { next?: unknown }
    expect(opts.cache).toBe('no-store')
    expect(opts.next).toBeUndefined()
  })
})
