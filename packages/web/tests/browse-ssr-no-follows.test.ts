import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('@/lib/follows-server', () => ({
  getFollowedAuthorHandles: vi.fn(async () => new Set(['already-followed'])),
  withViewerFollows: <T extends { handle: string }>(
    items: T[],
    followed: Set<string>,
  ) => items.map((p) => ({ ...p, viewerFollows: followed.has(p.handle) })),
}))

vi.mock('@/lib/registry', () => ({
  getKitCatalog: vi.fn(async () => ({ items: [], total: 0, limit: 10, offset: 0 })),
  getSkillCatalog: vi.fn(async () => ({ skills: [], total: 0, limit: 10, offset: 0 })),
  getPeopleCatalog: vi.fn(async () => ({
    items: [{ handle: 'already-followed', displayName: 'A', avatarUrl: null, followers: 1 }],
    total: 1,
    limit: 10,
    offset: 0,
  })),
  getDiscoverFeed: vi.fn(async () => ({
    events: [],
    followingCount: 0,
    view: 'discover',
    nextCursor: null,
  })),
}))

vi.mock('@/lib/blog', () => ({
  getAllPosts: vi.fn(() => []),
}))

describe('browse SSR no follows (U2)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('skips getFollowedAuthorHandles when ssrViewerFollows is false', async () => {
    const { getFollowedAuthorHandles } = await import('@/lib/follows-server')
    const { HomeCatalogShelves } = await import('@/components/home/home-shelves')
    await HomeCatalogShelves({
      viewerHandle: 'viewer',
      seeAll: false,
      kitCount: 3,
      ssrViewerFollows: false,
    })
    expect(getFollowedAuthorHandles).not.toHaveBeenCalled()
  })

  it('still SSR-fetches follows by default (homepage)', async () => {
    const { getFollowedAuthorHandles } = await import('@/lib/follows-server')
    const { HomeCatalogShelves } = await import('@/components/home/home-shelves')
    await HomeCatalogShelves({ viewerHandle: 'viewer', kitCount: 3, chartSize: 5 })
    expect(getFollowedAuthorHandles).toHaveBeenCalled()
  })

  it('Browse Featured page opts out of SSR follows', () => {
    const src = readFileSync(
      resolve(__dirname, '../src/app/(consumer)/browse/page.tsx'),
      'utf8',
    )
    // Featured may call HomeCatalogShelves as a function (probe spans) or JSX.
    expect(src).toMatch(/ssrViewerFollows(?:=|:)\s*false/)
  })

  it('ExploreSurface people path does not call getFollowedAuthorHandles', () => {
    const src = readFileSync(
      resolve(__dirname, '../src/app/(consumer)/skills/explore-surface.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/getFollowedAuthorHandles\s*\(/)
  })
})

describe('browse bootstrap defer (U1)', () => {
  it('consumer layout defers getMeBootstrap on Browse pathnames', () => {
    const src = readFileSync(
      resolve(__dirname, '../src/app/(consumer)/layout.tsx'),
      'utf8',
    )
    expect(src).toContain('isBrowsePathname')
    expect(src).toContain('deferBootstrap')
    expect(src).toContain('getMeBootstrap')
  })

  it('isBrowsePathname matches Browse routes only', async () => {
    const { isBrowsePathname } = await import('@/lib/browse-pathname')
    expect(isBrowsePathname('/browse')).toBe(true)
    expect(isBrowsePathname('/browse/all')).toBe(true)
    expect(isBrowsePathname('/browse/frontend/people')).toBe(true)
    expect(isBrowsePathname('/')).toBe(false)
    expect(isBrowsePathname('/settings')).toBe(false)
    expect(isBrowsePathname('/browser')).toBe(false)
  })

  it('live proxy forwards x-pathname on NextResponse.next', () => {
    const src = readFileSync(resolve(__dirname, '../src/proxy.ts'), 'utf8')
    expect(src).toContain('x-pathname')
    expect(src).toMatch(/NextResponse\.next\(\s*\{\s*request:\s*\{\s*headers/)
  })

  it('does not rely on deprecated middleware.ts for pathname', () => {
    const middlewarePath = resolve(__dirname, '../src/middleware.ts')
    expect(() => readFileSync(middlewarePath, 'utf8')).toThrow()
  })
})
