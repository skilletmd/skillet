import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Deprecation on the web data layer:
//   • mapDetail carries deprecated / deprecation_message / deprecated_at off the
//     wire (owner-authenticated detail only).
//   • fetchLive treats a 410 like a 404 (absent → undefined), so the public
//     first pass falls through to the session retry instead of throwing.
//   • getSkillTombstone reads the 410 body so the not-found fallback can render
//     a tombstone instead of a bare 404.

const cookieJar = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => cookieJar) }))

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

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}
function statusResponse(status: number, body: unknown = {}) {
  return { ok: false, status, json: async () => body } as Response
}

const fetchMock = vi.fn()

async function loadRegistry() {
  vi.resetModules()
  process.env.NEXT_PUBLIC_REGISTRY_URL = 'https://registry.example.com'
  return import('@/lib/registry')
}

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

describe('mapDetail — deprecation fields (U1)', () => {
  it('carries deprecated + message + timestamp off the wire', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...DETAIL,
        deprecated: true,
        deprecation_message: 'Use taylor/deploy-v2 instead.',
        deprecated_at: 1_717_500_000,
      }),
    )
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual', { skipScan: true })
    expect(skill?.deprecated).toBe(true)
    expect(skill?.deprecationMessage).toBe('Use taylor/deploy-v2 instead.')
    expect(skill?.deprecatedAt).toBe(new Date(1_717_500_000 * 1000).toISOString())
  })

  it('leaves deprecation undefined/falsy when the wire omits it (back-compat)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(DETAIL))
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual', { skipScan: true })
    expect(skill?.deprecated).toBeFalsy()
    expect(skill?.deprecationMessage ?? null).toBeNull()
  })

  it('maps deprecated with a null message', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ ...DETAIL, deprecated: true, deprecation_message: null, deprecated_at: null }),
    )
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual', { skipScan: true })
    expect(skill?.deprecated).toBe(true)
    expect(skill?.deprecationMessage).toBeNull()
    expect(skill?.deprecatedAt).toBeNull()
  })
})

describe('fetchLive / getSkill — 410 is absent, not down (U4)', () => {
  it('getSkill returns null on a 410 (falls through to the session retry / tombstone)', async () => {
    fetchMock.mockResolvedValue(statusResponse(410, { error: 'deprecated' }))
    const { getSkill } = await loadRegistry()
    expect(await getSkill('taylor', 'deploy-ritual', { skipScan: true })).toBeNull()
  })
})

describe('getSkillTombstone (U4)', () => {
  it('returns message + date on a 410', async () => {
    fetchMock.mockResolvedValue(
      statusResponse(410, {
        error: 'deprecated',
        deprecated: true,
        deprecation_message: 'Sunset — moved to taylor/deploy-v2.',
        deprecated_at: 1_717_500_000,
      }),
    )
    const { getSkillTombstone } = await loadRegistry()
    const tomb = await getSkillTombstone('taylor', 'deploy-ritual')
    expect(tomb).toEqual({
      message: 'Sunset — moved to taylor/deploy-v2.',
      deprecatedAt: new Date(1_717_500_000 * 1000).toISOString(),
    })
  })

  it('returns null on a 404 (truly absent)', async () => {
    fetchMock.mockResolvedValue(statusResponse(404))
    const { getSkillTombstone } = await loadRegistry()
    expect(await getSkillTombstone('taylor', 'nope')).toBeNull()
  })

  it('returns null on a 200 (live skill)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(DETAIL))
    const { getSkillTombstone } = await loadRegistry()
    expect(await getSkillTombstone('taylor', 'deploy-ritual')).toBeNull()
  })
})
