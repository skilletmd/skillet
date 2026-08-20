import { describe, it, expect, vi, beforeEach } from 'vitest'
import { importRepoAsKit } from '@/lib/import-repo-as-kit'
import { publishSkillFromBrowser } from '@/lib/skill-studio-client'
import type { SkillDiscoveryResult } from '@/lib/skill-import'

vi.mock('@/lib/skill-import', () => ({
  importDiscoveredSkill: vi.fn(async () => ({ files: {}, source: 'x' })),
}))
vi.mock('@/lib/skill-studio-client', () => ({
  publishSkillFromBrowser: vi.fn(async () => ({ hash: 'h', skill_id: 'x' })),
}))
vi.mock('@/lib/skill-bundle', () => ({ skillMdFromBundle: () => 'md' }))
vi.mock('@/lib/skill-md-metadata', () => ({
  // Force the fallback to skill.name, then slug it deterministically.
  skillMarkdownMetadata: () => ({ name: undefined }),
  slugifySkillName: (s: string) => s.toLowerCase().replace(/\s+/g, '-'),
}))
vi.mock('@/lib/registry-proxy', () => ({
  registryAuthApi: (p: string) => `/api/registry/api/v1/${p}`,
}))

const discovery: SkillDiscoveryResult = {
  owner: 'maya',
  repo: 'skills',
  ref: 'main',
  prefix: '',
  source: 'github.com/maya/skills',
  skills: [
    { dir: 'a', name: 'Tighten Prose', description: '', coupled: false, files: [] },
    { dir: 'b', name: 'Cut Fluff', description: '', coupled: false, files: [] },
  ],
  total: 2,
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url.endsWith('/kits') && init?.method === 'POST') {
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ id: 'kit-x' }) })
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })
  vi.stubGlobal('fetch', fetchMock)
})

describe('importRepoAsKit', () => {
  it('publishes each selected skill, creates a linked kit, and links them', async () => {
    const res = await importRepoAsKit({
      author: 'me',
      discovery,
      selected: discovery.skills,
      kitName: 'My Kit',
      visibility: 'private',
    })

    expect(res.kitId).toBe('kit-x')
    expect(res.failed).toEqual([])
    expect(res.published).toEqual([
      { author: 'me', slug: 'tighten-prose' },
      { author: 'me', slug: 'cut-fluff' },
    ])
    expect(publishSkillFromBrowser).toHaveBeenCalledTimes(2)

    // Kit created with the source repo recorded.
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/registry/api/v1/kits',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"repo":"maya/skills"'),
      }),
    )
    // Each published skill linked into the kit.
    expect(
      fetchMock.mock.calls.filter(
        ([url, init]) =>
          url === '/api/registry/api/v1/kits/kit-x/skills' && init?.method === 'POST',
      ),
    ).toHaveLength(2)
  })

  it('skips a failed publish and still kits the successes (>1)', async () => {
    // Three skills, first fails → two succeed → a kit is still formed.
    const discovery3: SkillDiscoveryResult = {
      ...discovery,
      skills: [
        ...discovery.skills,
        { dir: 'c', name: 'Third Skill', description: '', coupled: false, files: [] },
      ],
      total: 3,
    }
    vi.mocked(publishSkillFromBrowser)
      .mockRejectedValueOnce(new Error('signing not ready'))
      .mockResolvedValue({ hash: 'h', skill_id: 'x' })

    const res = await importRepoAsKit({
      author: 'me',
      discovery: discovery3,
      selected: discovery3.skills,
      kitName: 'My Kit',
      visibility: 'private',
    })

    expect(res.failed).toEqual([{ label: 'Tighten Prose', error: 'signing not ready' }])
    expect(res.published).toEqual([
      { author: 'me', slug: 'cut-fluff' },
      { author: 'me', slug: 'third-skill' },
    ])
    expect(res.kitId).toBe('kit-x')
  })

  it('a single successful skill is NOT bundled into a kit', async () => {
    vi.mocked(publishSkillFromBrowser).mockResolvedValueOnce({ hash: 'h', skill_id: 'x' })
    const res = await importRepoAsKit({
      author: 'me',
      discovery: { ...discovery, skills: [discovery.skills[0]!], total: 1 },
      selected: [discovery.skills[0]!],
      kitName: 'Solo',
      visibility: 'private',
    })
    expect(res.published).toEqual([{ author: 'me', slug: 'tighten-prose' }])
    expect(res.kitId).toBeNull()
  })
})
