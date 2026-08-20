import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Force a configured registry so getSkill/getAuthorProfile take the live-fetch
// path (not the in-repo mock fallback) and we can observe the exact requests.
vi.mock('./registry-mock', () => ({
  REGISTRY_BASE_URL: 'http://reg.test',
  MOCK_SKILLS: [],
  MOCK_AUTHORS: [],
}))

import { getSkill, getAuthorProfile, getAuthorProfileCached } from './registry'

const SKILL_DETAIL = {
  author: 'a',
  slug: 's',
  description: 'a skill',
  visibility: 'public',
  install_count: 3,
  latest_hash: 'sha256:abc',
  category: null,
  signatureStatus: 'unverified',
  created_at: 0,
  versions: [],
  // A summary-level scan status so mapSecurity synthesizes a badge (so
  // hydrateScanReport has a `security` block to augment).
  scanStatus: 'clean',
}

const SCAN_REPORT = {
  status: 'clean',
  findings_summary: { total: 0 },
  findings: [],
  capabilities: [{ capability: 'network', risky: false, evidence: [] }],
  capabilities_analysis: 'full',
  capabilities_blind_spots: [],
}

const AUTHOR_PAGE = {
  id: 'a',
  name: 'Alice',
  avatar_url: null,
  bio: 'hi',
  created_at: 0,
  total_installs: 10,
  skills: [],
}

interface FetchCall {
  url: string
  auth: string | null
}

let calls: FetchCall[]

function installFetch(): void {
  calls = []
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url: u, auth: headers.authorization ?? null })
    const body = u.includes('/scan')
      ? SCAN_REPORT
      : u.includes('/authors/')
        ? AUTHOR_PAGE
        : SKILL_DETAIL
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
}

beforeEach(() => {
  installFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getSkill skipScan (U4)', () => {
  it('hydrates the scan report by default — one detail fetch + one /scan fetch', async () => {
    const skill = await getSkill('a', 's')
    expect(skill).not.toBeNull()
    const scanCalls = calls.filter((c) => c.url.includes('/scan'))
    expect(scanCalls).toHaveLength(1)
    // Capabilities were hydrated from the /scan report.
    expect(skill?.capabilities?.map((c) => c.capability)).toEqual(['network'])
  })

  it('skipScan: true issues ZERO /scan fetches and does not hydrate capabilities', async () => {
    const skill = await getSkill('a', 's', { skipScan: true })
    expect(skill).not.toBeNull()
    const scanCalls = calls.filter((c) => c.url.includes('/scan'))
    expect(scanCalls).toHaveLength(0)
    // The single detail fetch still happened.
    expect(calls.some((c) => c.url.endsWith('/skills/a/s'))).toBe(true)
    // No capabilities hydrated (the /scan roundtrip was skipped).
    expect(skill?.capabilities).toBeUndefined()
  })
})

describe('getAuthorProfileCached (U7)', () => {
  it('resolves the author profile anonymously (no bearer token)', async () => {
    const profile = await getAuthorProfileCached('a')
    expect(profile?.username).toBe('a')
    const authorCalls = calls.filter((c) => c.url.includes('/authors/a'))
    expect(authorCalls).toHaveLength(1)
    // The cached read is anonymous — never carries a viewer token.
    expect(authorCalls[0].auth).toBeNull()
  })

  it('returns the same shape as the direct anonymous getAuthorProfile', async () => {
    const viaCache = await getAuthorProfileCached('a')
    const direct = await getAuthorProfile('a')
    expect(viaCache).toEqual(direct)
  })
})
