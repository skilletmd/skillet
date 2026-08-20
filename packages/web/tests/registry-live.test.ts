import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Exercises the live wiring (NEXT_PUBLIC_REGISTRY_URL set): the registry serves
// snake_case SkillSummary JSON (PR #80) and the data layer must map it
// to the camelCase UI shapes. Env is captured at module load, so we set it and
// re-import per case.

const cookieJar = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => cookieJar),
}))

const SUMMARY = {
  author: 'taylor',
  slug: 'deploy-ritual',
  skill_id: 'taylor:deploy-ritual',
  description: 'Pre-deploy checklist.',
  visibility: 'public' as const,
  latest_hash: 'abcdef0123456789',
  install_count: 771,
  created_at: 1_717_000_000, // unix seconds
  signatureStatus: 'verified' as const,
}

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
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
  delete process.env.NEXT_PUBLIC_REGISTRY_URL
})

describe('registry live mapping', () => {
  it('maps a skill detail response to the UI Skill shape', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...SUMMARY,
        author_name: 'Taylor',
        author_avatar_url: null,
        author_key_id: 'ed25519:abc',
        author_public_key: 'pk',
        manifest_url: '/api/v1/skills/taylor/deploy-ritual/manifest',
      }),
    )
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/api/v1/skills/taylor/deploy-ritual',
      expect.anything(),
    )
    expect(skill).toMatchObject({
      author: 'taylor',
      slug: 'deploy-ritual',
      // The registry carries no display title; the mapper humanizes the slug.
      title: 'Deploy Ritual',
      description: 'Pre-deploy checklist.',
      installCount: 771,
      signatureStatus: 'verified',
    })
    expect(skill?.latestVersion).toBe('abcdef012345')
    expect(skill?.publishedAt).toBe(new Date(1_717_000_000 * 1000).toISOString())
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.cache).toBe('no-store')
  })

  it('prefers the semver label for latest version and history rows when served', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...SUMMARY,
        version: 3,
        version_label: '2.1.0',
        versions: [
          { hash: 'sha256:c', published_at: 1_717_200_000, version_label: '2.1.0' },
          { hash: 'sha256:b', published_at: 1_717_100_000, version_label: '2.0.0' },
          { hash: 'sha256:a', published_at: 1_717_000_000, version_label: '1.0.0' },
        ],
        author_name: 'Taylor',
        author_avatar_url: null,
        author_key_id: 'ed25519:abc',
        author_public_key: 'pk',
        manifest_url: '/api/v1/skills/taylor/deploy-ritual/manifest',
      }),
    )
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual')
    expect(skill?.latestVersion).toBe('v2.1.0')
    expect(skill?.versions.map((v) => v.version)).toEqual(['v2.1.0', 'v2.0.0', 'v1.0.0'])
  })

  it('falls back to the positional vN history when the registry omits labels', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...SUMMARY,
        version: 2,
        versions: [
          { hash: 'sha256:b', published_at: 1_717_100_000 },
          { hash: 'sha256:a', published_at: 1_717_000_000 },
        ],
        author_name: 'Taylor',
        author_avatar_url: null,
        author_key_id: 'ed25519:abc',
        author_public_key: 'pk',
        manifest_url: '/api/v1/skills/taylor/deploy-ritual/manifest',
      }),
    )
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual')
    expect(skill?.latestVersion).toBe('v2')
    expect(skill?.versions.map((v) => v.version)).toEqual(['v2', 'v1'])
  })

  it('prefers the semver label on feed skill events (activity rows render it)', async () => {
    const { mapDiscoverFeedEvents } = await import('@/lib/registry-feed-mapper')
    const base = {
      kind: 'skill',
      type: 'updated',
      actor: 'taylor',
      at: 1_717_000_000,
      skill: { author: 'taylor', slug: 'deploy-ritual', description: null, version: '3' },
    }
    const [labeled] = mapDiscoverFeedEvents([
      { ...base, skill: { ...base.skill, version_label: '2.1.0' } },
    ])
    const [fallback] = mapDiscoverFeedEvents([base])
    expect(labeled.kind === 'skill' && labeled.skill.version).toBe('2.1.0')
    expect(fallback.kind === 'skill' && fallback.skill.version).toBe('3')
  })

  it('maps invocation facts (model_invoked / has_command) onto the Skill', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...SUMMARY,
        author_name: 'Taylor',
        author_avatar_url: null,
        author_key_id: 'ed25519:abc',
        author_public_key: 'pk',
        manifest_url: '/api/v1/skills/taylor/deploy-ritual/manifest',
        model_invoked: false,
        has_command: true,
      }),
    )
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual')
    expect(skill?.modelInvoked).toBe(false)
    expect(skill?.hasCommand).toBe(true)
  })

  it('attaches the session token when a route requests owner-visible data', async () => {
    cookieJar.get.mockImplementation((name: string) =>
      name === 'skillet_session' ? { value: 'session_123' } : undefined,
    )
    fetchMock.mockResolvedValue(
      jsonResponse({
        ...SUMMARY,
        visibility: 'private',
        author_name: 'Taylor',
        author_avatar_url: null,
        author_key_id: 'ed25519:abc',
        author_public_key: 'pk',
        manifest_url: '/api/v1/skills/taylor/deploy-ritual/manifest',
      }),
    )
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual', { withSession: true })

    const [, init] = fetchMock.mock.calls[0]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer session_123')
    expect(init.cache).toBe('no-store')
    expect(skill?.visibility).toBe('private')
  })

  it('returns null on a 404 in live mode (no mock fallback)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response)
    const { getSkill } = await loadRegistry()
    expect(await getSkill('skillet', 'skillet-sync')).toBeNull()
  })

  it('derives static skill slugs and author usernames from the catalog', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        skills: [SUMMARY, { ...SUMMARY, author: 'ada', slug: 'writing-voice' }],
        total: 2,
        limit: 100,
        offset: 0,
      }),
    )
    const { getAllSkillSlugs, getAllAuthorUsernames } = await loadRegistry()
    expect(await getAllSkillSlugs()).toEqual([
      { author: 'taylor', slug: 'deploy-ritual' },
      { author: 'ada', slug: 'writing-voice' },
    ])

    fetchMock.mockResolvedValue(
      jsonResponse({
        skills: [SUMMARY, { ...SUMMARY, author: 'ada' }, { ...SUMMARY, author: 'taylor' }],
        total: 3,
        limit: 100,
        offset: 0,
      }),
    )
    expect(await getAllAuthorUsernames()).toEqual(['taylor', 'ada'])
  })

  it('passes the catalog response through and never fabricates seed skills', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ skills: [SUMMARY], total: 1, limit: 24, offset: 0 }))
    const { getSkillCatalog } = await loadRegistry()
    const res = await getSkillCatalog({ limit: 24, offset: 0 })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/api/v1/skills?limit=24&offset=0',
      expect.anything(),
    )
    const [, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { next?: { revalidate?: number; tags?: string[] } },
    ]
    expect(init.cache).not.toBe('no-store')
    // 60s safety-net TTL; tagged so a write-path revalidateTag flushes it on demand.
    expect(init.next?.revalidate).toBe(60)
    expect(init.next?.tags).toContain('catalog:skills')
    expect(res.skills).toHaveLength(1)
    expect(res.skills[0].slug).toBe('deploy-ritual')
  })

  it('throws (no mock fallback) when the live catalog returns non-OK', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response)
    const { getSkillCatalog, RegistryUnavailableError } = await loadRegistry()
    await expect(getSkillCatalog({ limit: 24 })).rejects.toBeInstanceOf(RegistryUnavailableError)
  })

  it('throws (no mock fallback) when the live catalog fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { getSkillCatalog, RegistryUnavailableError } = await loadRegistry()
    await expect(getSkillCatalog({ limit: 24 })).rejects.toBeInstanceOf(RegistryUnavailableError)
  })

  it('includes a dev hint when localhost registry is unreachable', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('NEXT_PUBLIC_REGISTRY_URL', 'http://127.0.0.1:3481')
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { getSkillCatalog } = await import('@/lib/registry')
    await expect(getSkillCatalog({ limit: 24 })).rejects.toThrow(/Node 24 LTS/)
  })

  it('static-params helpers degrade to empty on a registry outage', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { getAllSkillSlugs, getAllAuthorUsernames } = await loadRegistry()
    expect(await getAllSkillSlugs()).toEqual([])
    expect(await getAllAuthorUsernames()).toEqual([])
  })

  it('maps an author page response, mapping skill summaries', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: 'taylor',
        name: 'Taylor',
        avatar_url: 'https://example.com/a.png',
        created_at: 1_717_000_000,
        kind: 'team',
        total_installs: 771,
        skills: [SUMMARY],
      }),
    )
    const { getAuthorProfile } = await loadRegistry()
    const profile = await getAuthorProfile('taylor')

    expect(profile).toMatchObject({
      username: 'taylor',
      displayName: 'Taylor',
      kind: 'team',
      avatarUrl: 'https://example.com/a.png',
      totalInstalls: 771,
    })
    expect(profile?.skills[0].signatureStatus).toBe('verified')
  })

  it('hydrates the findings list from the per-version scan endpoint when flagged', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/versions/abcdef0123456789/scan')) {
        return Promise.resolve(
          jsonResponse({
            status: 'flagged',
            findings_summary: { total: 2 },
            findings: [
              {
                category: 'network-egress',
                confidence: 'low',
                file: 'skill.md',
                lineStart: 12,
                lineEnd: 14,
                why: 'Outbound fetch to a non-allowlisted host.',
              },
              {
                category: 'exec-injection',
                confidence: 'medium',
                file: 'scripts/run.sh',
                lineStart: 3,
                lineEnd: 3,
                why: 'Shell exec of an interpolated variable.',
              },
            ],
          }),
        )
      }
      return Promise.resolve(
        jsonResponse({
          ...SUMMARY,
          scanStatus: 'flagged',
          author_name: 'Taylor',
          author_avatar_url: null,
          author_key_id: 'ed25519:abc',
          author_public_key: 'pk',
          manifest_url: '/api/v1/skills/taylor/deploy-ritual/manifest',
        }),
      )
    })
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/api/v1/skills/taylor/deploy-ritual/versions/abcdef0123456789/scan',
      expect.anything(),
    )
    expect(skill?.security?.status).toBe('flagged')
    expect(skill?.security?.findingCount).toBe(2)
    expect(skill?.security?.findings).toHaveLength(2)
    // The scanner reports a line range; the tab collapses it to the start line.
    expect(skill?.security?.findings[0]).toMatchObject({
      category: 'network-egress',
      confidence: 'low',
      file: 'skill.md',
      line: 12,
      why: 'Outbound fetch to a non-allowlisted host.',
    })
  })

  it('fetches the scan endpoint for a clean skill (capabilities) but never grows its findings', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/versions/abcdef0123456789/scan')) {
        return Promise.resolve(
          jsonResponse({
            status: 'clean',
            findings_summary: { total: 0 },
            findings: [],
            capabilities: [
              {
                capability: 'runs-shell',
                risky: false,
                evidence: [
                  { file: 'scripts/run.sh', lineStart: 1, lineEnd: 1, source: 'code' },
                ],
              },
              {
                capability: 'network',
                risky: false,
                evidence: [
                  { file: 'SKILL.md', lineStart: 8, lineEnd: 8, source: 'instructions' },
                ],
              },
            ],
          }),
        )
      }
      return Promise.resolve(
        jsonResponse({
          ...SUMMARY,
          scanStatus: 'clean',
          author_name: 'Taylor',
          author_avatar_url: null,
          author_key_id: 'ed25519:abc',
          author_public_key: 'pk',
          manifest_url: '/api/v1/skills/taylor/deploy-ritual/manifest',
        }),
      )
    })
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual')

    // Detail + scan (the scan fetch now runs for clean skills, for capabilities).
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/api/v1/skills/taylor/deploy-ritual/versions/abcdef0123456789/scan',
      expect.anything(),
    )
    // Threat-findings hydration is unchanged: a clean skill never grows findings.
    expect(skill?.security?.status).toBe('clean')
    expect(skill?.security?.findings).toEqual([])
    // Capabilities are mapped and present for the clean skill.
    expect(skill?.capabilities).toEqual([
      {
        capability: 'runs-shell',
        risky: false,
        evidence: [{ file: 'scripts/run.sh', lineStart: 1, lineEnd: 1, source: 'code' }],
      },
      {
        capability: 'network',
        risky: false,
        evidence: [{ file: 'SKILL.md', lineStart: 8, lineEnd: 8, source: 'instructions' }],
      },
    ])
    // Analysis qualifier defaults to 'full' when the field is absent but
    // capabilities are computed.
    expect(skill?.capabilitiesAnalysis).toBe('full')
  })

  it('threads capabilities_analysis: partial through to the mapped skill', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/scan')) {
        return Promise.resolve(
          jsonResponse({
            status: 'clean',
            findings_summary: { total: 0 },
            findings: [],
            capabilities: [
              {
                capability: 'runs-shell',
                risky: false,
                evidence: [{ file: 'scripts/run.sh', lineStart: 1, lineEnd: 1, source: 'code' }],
              },
            ],
            // Some executable-shaped file went un-inspected (unhandled language).
            capabilities_analysis: 'partial',
          }),
        )
      }
      return Promise.resolve(
        jsonResponse({
          ...SUMMARY,
          scanStatus: 'clean',
          author_name: 'Taylor',
          author_avatar_url: null,
          author_key_id: 'ed25519:abc',
          author_public_key: 'pk',
          manifest_url: '/api/v1/skills/taylor/deploy-ritual/manifest',
        }),
      )
    })
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual')
    expect(skill?.capabilities).toHaveLength(1)
    expect(skill?.capabilitiesAnalysis).toBe('partial')
  })

  it('maps capabilities + risky flags alongside findings for a flagged skill', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/versions/abcdef0123456789/scan')) {
        return Promise.resolve(
          jsonResponse({
            status: 'flagged',
            findings_summary: { total: 1 },
            findings: [
              {
                category: 'destructive',
                confidence: 'high',
                file: 'scripts/wipe.sh',
                lineStart: 4,
                lineEnd: 4,
                why: 'Destructive disk operation.',
              },
            ],
            capabilities: [
              {
                capability: 'deletes-files',
                risky: true,
                evidence: [{ file: 'scripts/wipe.sh', lineStart: 4, lineEnd: 4, source: 'code' }],
              },
            ],
          }),
        )
      }
      return Promise.resolve(
        jsonResponse({
          ...SUMMARY,
          scanStatus: 'flagged',
          author_name: 'Taylor',
          author_avatar_url: null,
          author_key_id: 'ed25519:abc',
          author_public_key: 'pk',
          manifest_url: '/api/v1/skills/taylor/deploy-ritual/manifest',
        }),
      )
    })
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual')

    expect(skill?.security?.status).toBe('flagged')
    expect(skill?.security?.findings).toHaveLength(1)
    expect(skill?.capabilities).toEqual([
      {
        capability: 'deletes-files',
        risky: true,
        evidence: [{ file: 'scripts/wipe.sh', lineStart: 4, lineEnd: 4, source: 'code' }],
      },
    ])
  })

  it('preserves computed-empty ([]) capabilities distinct from not-computed (null)', async () => {
    const detail = {
      ...SUMMARY,
      scanStatus: 'clean' as const,
      author_name: 'Taylor',
      author_avatar_url: null,
      author_key_id: 'ed25519:abc',
      author_public_key: 'pk',
      manifest_url: '/api/v1/skills/taylor/deploy-ritual/manifest',
    }

    // Computed-and-none → []
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/scan')) {
        return Promise.resolve(
          jsonResponse({ status: 'clean', findings_summary: { total: 0 }, findings: [], capabilities: [] }),
        )
      }
      return Promise.resolve(jsonResponse(detail))
    })
    const { getSkill } = await loadRegistry()
    const empty = await getSkill('taylor', 'deploy-ritual')
    expect(empty?.capabilities).toEqual([])
    // Computed-and-none with no analysis field → 'full' (a real "nothing detected").
    expect(empty?.capabilitiesAnalysis).toBe('full')

    // Not computed (older version, field absent/null) → null, and analysis null
    // mirrors it (never claims "none").
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/scan')) {
        return Promise.resolve(
          jsonResponse({ status: 'clean', findings_summary: { total: 0 }, findings: [], capabilities: null }),
        )
      }
      return Promise.resolve(jsonResponse(detail))
    })
    const notComputed = await getSkill('taylor', 'deploy-ritual')
    expect(notComputed?.capabilities).toBeNull()
    expect(notComputed?.capabilitiesAnalysis).toBeNull()
  })

  it('degrades to the badge alone when the scan endpoint is unreachable', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/scan')) return Promise.reject(new Error('ECONNREFUSED'))
      return Promise.resolve(
        jsonResponse({
          ...SUMMARY,
          scanStatus: 'flagged',
          author_name: 'Taylor',
          author_avatar_url: null,
          author_key_id: 'ed25519:abc',
          author_public_key: 'pk',
          manifest_url: '/api/v1/skills/taylor/deploy-ritual/manifest',
        }),
      )
    })
    const { getSkill } = await loadRegistry()
    const skill = await getSkill('taylor', 'deploy-ritual')

    expect(skill?.security?.status).toBe('flagged')
    expect(skill?.security?.findings).toEqual([])
  })

  it('getSkillCapabilities maps the scan report into a capability report', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        status: 'clean',
        capabilities: [
          {
            capability: 'network',
            risky: true,
            evidence: [{ file: 'fetch.ts', lineStart: 4, lineEnd: 6, source: 'code' }],
          },
        ],
        capabilities_analysis: 'partial',
      }),
    )
    const { getSkillCapabilities } = await loadRegistry()
    const report = await getSkillCapabilities('taylor', 'deploy-ritual', 'abc')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/api/v1/skills/taylor/deploy-ritual/versions/abc/scan',
      expect.anything(),
    )
    expect(report).toEqual({
      capabilities: [
        {
          capability: 'network',
          risky: true,
          evidence: [{ file: 'fetch.ts', lineStart: 4, lineEnd: 6, source: 'code' }],
        },
      ],
      analysis: 'partial',
    })
  })

  it('getSkillCapabilities preserves null (not computed) vs [] (computed-none)', async () => {
    // capabilities: null → null report (never computed).
    fetchMock.mockResolvedValue(jsonResponse({ status: 'clean', capabilities: null }))
    const { getSkillCapabilities } = await loadRegistry()
    expect(await getSkillCapabilities('taylor', 'deploy-ritual', 'abc')).toBeNull()

    // capabilities: [] with no analysis field → computed-none, analysis 'full'.
    fetchMock.mockResolvedValue(jsonResponse({ status: 'clean', capabilities: [] }))
    expect(await getSkillCapabilities('taylor', 'deploy-ritual', 'abc')).toEqual({
      capabilities: [],
      analysis: 'full',
    })
  })

  it('getSkillCapabilities returns null when the scan endpoint is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { getSkillCapabilities } = await loadRegistry()
    expect(await getSkillCapabilities('taylor', 'deploy-ritual', 'abc')).toBeNull()
  })

  it('returns empty stats when the registry responds non-OK', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response)
    const { getRegistryStats } = await loadRegistry()
    const stats = await getRegistryStats()
    expect(fetchMock).toHaveBeenCalledWith(
      'https://registry.example.com/api/v1/stats',
      expect.anything(),
    )
    expect(stats.totals.skills).toBe(0)
    expect(stats.growth).toEqual([])
  })

  it('returns empty stats when the registry fetch rejects', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const { getRegistryStats } = await loadRegistry()
    const stats = await getRegistryStats()
    expect(stats.totals.users).toBe(0)
    expect(stats.categories).toEqual([])
  })
})
