import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// U8 — the web data-layer failure contract. ONE rule, applied consistently:
//   • a real HTTP 404 from the registry = ABSENT  → null / undefined / []
//   • a network error or a non-OK, non-404 (500/502/503/timeout) = DOWN
//     → throw RegistryUnavailableError (distinguishable from absent), and
//   • every degraded/thrown path logs its cause server-side (no silent swallow).
//
// Env is captured at module load, so we set NEXT_PUBLIC_REGISTRY_URL and re-import
// per case — same harness as registry-live.test.ts.

const cookieJar = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieJar),
}))

const DETAIL = {
  author: 'taylor',
  slug: 'deploy-ritual',
  skill_id: 'taylor:deploy-ritual',
  description: 'Pre-deploy checklist.',
  visibility: 'public' as const,
  latest_hash: 'abcdef0123456789',
  install_count: 771,
  created_at: 1_717_000_000,
  signatureStatus: 'verified' as const,
  author_name: 'Taylor',
  author_avatar_url: null,
  author_key_id: 'ed25519:abc',
  author_public_key: 'pk',
  manifest_url: '/api/v1/skills/taylor/deploy-ritual/manifest',
}

const AUTHOR_PAGE = {
  id: 'taylor',
  name: 'Taylor',
  avatar_url: null,
  created_at: 1_717_000_000,
  total_installs: 771,
  skills: [],
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}
function statusResponse(status: number) {
  return { ok: false, status, json: async () => ({}) } as Response
}

async function loadRegistry() {
  vi.resetModules()
  process.env.NEXT_PUBLIC_REGISTRY_URL = 'https://registry.example.com'
  return import('@/lib/registry')
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  cookieJar.get.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.NEXT_PUBLIC_REGISTRY_URL
})

describe('U8 — registry DOWN surfaces distinguishably (not as a 404)', () => {
  it('getSkill THROWS RegistryUnavailableError when the fetch rejects (outage)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { getSkill, RegistryUnavailableError } = await loadRegistry()
    await expect(getSkill('taylor', 'deploy-ritual')).rejects.toBeInstanceOf(
      RegistryUnavailableError,
    )
  })

  it('getSkill THROWS (not null) on a non-404 non-OK status (503)', async () => {
    fetchMock.mockResolvedValue(statusResponse(503))
    const { getSkill, RegistryUnavailableError } = await loadRegistry()
    await expect(getSkill('taylor', 'deploy-ritual')).rejects.toBeInstanceOf(
      RegistryUnavailableError,
    )
  })

  it('getAuthorProfile THROWS on an outage (so the page is not a 404)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { getAuthorProfile, RegistryUnavailableError } = await loadRegistry()
    await expect(getAuthorProfile('taylor')).rejects.toBeInstanceOf(RegistryUnavailableError)
  })

  it('getAuthorProfile THROWS on a 500', async () => {
    fetchMock.mockResolvedValue(statusResponse(500))
    const { getAuthorProfile, RegistryUnavailableError } = await loadRegistry()
    await expect(getAuthorProfile('taylor')).rejects.toBeInstanceOf(RegistryUnavailableError)
  })
})

describe('U8 — genuine ABSENCE maps to not-found, not unavailable', () => {
  it('getSkill returns null on a real 404', async () => {
    fetchMock.mockResolvedValue(statusResponse(404))
    const { getSkill } = await loadRegistry()
    expect(await getSkill('taylor', 'nope')).toBeNull()
  })

  it('getAuthorProfile returns null on a real 404', async () => {
    fetchMock.mockResolvedValue(statusResponse(404))
    const { getAuthorProfile } = await loadRegistry()
    expect(await getAuthorProfile('ghost')).toBeNull()
  })
})

describe('U8 — degraded paths log their cause (no silent swallow)', () => {
  it('logs to console.error before surfacing an outage from getSkill', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { getSkill } = await loadRegistry()
    await expect(getSkill('taylor', 'deploy-ritual')).rejects.toThrow()
    expect(spy).toHaveBeenCalled()
  })

  it('logs when a secondary section (getProfileActivity) degrades on an outage', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { getProfileActivity } = await loadRegistry()
    // Secondary section: degrades to [] (does NOT take the page down) but still logs.
    await expect(getProfileActivity('taylor')).resolves.toEqual([])
    expect(spy).toHaveBeenCalled()
  })
})

describe('U8 — secondary sections degrade softly, never throw', () => {
  it('getFeed returns null on an outage rather than throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { getFeed } = await loadRegistry()
    await expect(getFeed('discover')).resolves.toBeNull()
  })
})

describe('U8 — happy path still works (regression)', () => {
  it('getSkill maps a live detail response', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ ...DETAIL, scanStatus: 'clean' }))
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual')
    expect(skill).toMatchObject({ author: 'taylor', slug: 'deploy-ritual', installCount: 771 })
  })

  it('getAuthorProfile maps a live author page', async () => {
    fetchMock.mockResolvedValue(jsonResponse(AUTHOR_PAGE))
    const { getAuthorProfile } = await loadRegistry()
    const profile = await getAuthorProfile('taylor')
    expect(profile).toMatchObject({ username: 'taylor', displayName: 'Taylor' })
  })
})
