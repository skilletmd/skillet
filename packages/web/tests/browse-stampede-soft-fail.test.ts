import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { RegistryUnavailableError } from '@/lib/registry-errors'

vi.mock('@/auth', () => ({
  auth: vi.fn(async () => null),
}))

vi.mock('@/lib/follows-server', () => ({
  getFollowedAuthorHandles: vi.fn(async () => new Set<string>()),
  withViewerFollows: <T,>(items: T[]) => items,
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/browse/all',
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('@/components/kits/skill-kit-control', () => ({
  SkillKitControl: () => null,
}))

vi.mock('@/components/kits/subscribe-kit-button', () => ({
  SubscribeKitButton: () => null,
}))

vi.mock('@/app/(consumer)/skills/directory-pagination', () => ({
  DirectoryPagination: () => null,
}))

const catalogMocks = vi.hoisted(() => ({
  getSkillCatalog: vi.fn(),
  getKitCatalog: vi.fn(),
  getPeopleCatalog: vi.fn(),
}))

vi.mock('@/lib/registry', async () => {
  const actual = await vi.importActual<typeof import('@/lib/registry')>('@/lib/registry')
  return {
    ...actual,
    getSkillCatalog: catalogMocks.getSkillCatalog,
    getKitCatalog: catalogMocks.getKitCatalog,
    getPeopleCatalog: catalogMocks.getPeopleCatalog,
  }
})

describe('browse stampede soft-fail', () => {
  beforeEach(() => {
    catalogMocks.getSkillCatalog.mockReset()
    catalogMocks.getKitCatalog.mockReset()
    catalogMocks.getPeopleCatalog.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('soft-fails ExploreSurface when skill catalog is down', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    catalogMocks.getSkillCatalog.mockRejectedValue(
      new RegistryUnavailableError('The skill registry responded 503.'),
    )
    catalogMocks.getKitCatalog.mockResolvedValue({
      items: [],
      total: 0,
      limit: 8,
      offset: 0,
    })
    catalogMocks.getPeopleCatalog.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    })

    const { ExploreSurface } = await import('@/app/(consumer)/skills/explore-surface')
    const markup = renderToStaticMarkup(
      await ExploreSurface({ q: '', offset: 0, tab: 'all', category: '', sort: '' }),
    )

    expect(markup).toMatch(/Nothing here yet|Nothing matches/)
    expect(logSpy).toHaveBeenCalled()
    expect(
      logSpy.mock.calls.some(
        (args) => typeof args[0] === 'string' && args[0].includes('browse'),
      ),
    ).toBe(true)
  })

  it('keeps skills when kits and people soft-fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    catalogMocks.getSkillCatalog.mockResolvedValue({
      skills: [
        {
          author: 'taylor',
          slug: 'deploy-ritual',
          skill_id: 'taylor:deploy-ritual',
          title: 'Deploy ritual',
          description: 'Checklist',
          latest_hash: 'abc',
          install_count: 10,
          created_at: 1_700_000_000,
          signatureStatus: 'verified',
          category: 'ops',
        },
      ],
      total: 1,
      limit: 24,
      offset: 0,
    })
    catalogMocks.getKitCatalog.mockRejectedValue(
      new RegistryUnavailableError('Could not reach the skill registry.'),
    )
    catalogMocks.getPeopleCatalog.mockRejectedValue(
      new RegistryUnavailableError('Could not reach the skill registry.'),
    )

    const { ExploreSurface } = await import('@/app/(consumer)/skills/explore-surface')
    const markup = renderToStaticMarkup(
      await ExploreSurface({ q: '', offset: 0, tab: 'skills', category: '', sort: '' }),
    )

    expect(markup).toContain('deploy-ritual')
    expect(markup).not.toMatch(/Nothing here yet/)
  })

  it('does not hard-fetch people catalog from ContentGrid', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    catalogMocks.getSkillCatalog.mockResolvedValue({
      skills: [],
      total: 0,
      limit: 24,
      offset: 0,
    })
    catalogMocks.getKitCatalog.mockResolvedValue({
      items: [],
      total: 0,
      limit: 8,
      offset: 0,
    })
    catalogMocks.getPeopleCatalog.mockResolvedValue({
      items: [],
      total: 0,
      limit: 20,
      offset: 0,
    })

    const { ExploreSurface } = await import('@/app/(consumer)/skills/explore-surface')
    await ExploreSurface({ q: '', offset: 0, tab: 'skills', category: '', sort: '' })

    expect(catalogMocks.getPeopleCatalog).not.toHaveBeenCalled()
  })

  it('soft-fails people tab under registry pressure', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    catalogMocks.getPeopleCatalog.mockRejectedValue(
      new RegistryUnavailableError('The skill registry responded 503.'),
    )

    const { ExploreSurface } = await import('@/app/(consumer)/skills/explore-surface')
    const markup = renderToStaticMarkup(
      await ExploreSurface({ q: '', offset: 0, tab: 'people', category: '', sort: '' }),
    )

    expect(markup).toMatch(/No one to discover yet|No people match/)
    expect(
      logSpy.mock.calls.some(
        (args) => typeof args[0] === 'string' && args[0].includes('browse'),
      ),
    ).toBe(true)
  })

  it('degrades when all content catalog legs are down', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    catalogMocks.getSkillCatalog.mockRejectedValue(
      new RegistryUnavailableError('The skill registry responded 503.'),
    )
    catalogMocks.getKitCatalog.mockRejectedValue(
      new RegistryUnavailableError('Could not reach the skill registry.'),
    )
    catalogMocks.getPeopleCatalog.mockRejectedValue(
      new RegistryUnavailableError('Could not reach the skill registry.'),
    )

    const { ExploreSurface } = await import('@/app/(consumer)/skills/explore-surface')
    const markup = renderToStaticMarkup(
      await ExploreSurface({ q: '', offset: 0, tab: 'all', category: '', sort: '' }),
    )

    expect(markup).toMatch(/Nothing here yet|Nothing matches/)
    expect(
      logSpy.mock.calls.filter(
        (args) => typeof args[0] === 'string' && String(args[0]).includes('browse'),
      ).length,
    ).toBeGreaterThanOrEqual(1)
  })
})

describe('browse Link prefetch demand cut', () => {
  it('disables prefetch on stampede-relevant browse category Links', () => {
    const chrome = readFileSync(
      resolve(process.cwd(), 'src/app/(consumer)/browse/browse-chrome.tsx'),
      'utf8',
    )
    const strip = readFileSync(
      resolve(process.cwd(), 'src/app/(consumer)/browse/browse-strip.tsx'),
      'utf8',
    )
    expect(chrome).toMatch(/prefetch=\{false\}/)
    expect(strip).toMatch(/prefetch=\{false\}/)
    expect(chrome.match(/prefetch=\{false\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})

describe('softRegistry helper', () => {
  it('returns fallback and logs browse-scoped degrade', async () => {
    const logSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { softRegistry } = await import('@/lib/registry-soft')
    const result = await softRegistry(
      'browse catalog soft-fail (skills)',
      Promise.reject(new RegistryUnavailableError('down')),
      { skills: [], total: 0, limit: 0, offset: 0 },
    )
    expect(result.skills).toEqual([])
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('browse catalog soft-fail (skills)'),
      expect.anything(),
    )
  })
})
