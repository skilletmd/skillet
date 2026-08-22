import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('@/lib/get-session', () => ({
  getSession: vi.fn(),
}))

vi.mock('@/lib/registry', () => ({
  getKitCatalog: vi.fn(),
  getSkillCatalog: vi.fn(),
  getPeopleCatalog: vi.fn(),
  getDiscoverFeed: vi.fn(),
  getFeed: vi.fn(),
  getFollowSuggestions: vi.fn(),
}))

vi.mock('@/lib/blog', () => ({
  getAllPosts: vi.fn(() => []),
}))

vi.mock('@/components/kits/followed-curations-context', () => ({
  FollowedCurationsProvider: ({ children }: { children: React.ReactNode }) => children,
}))

describe('home shelves', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('loads public catalog fetches for logged-out visitors', async () => {
    const { getKitCatalog, getSkillCatalog, getPeopleCatalog, getDiscoverFeed } =
      await import('@/lib/registry')
    vi.mocked(getKitCatalog).mockResolvedValue({
      items: [{ id: 'k1', owner: 'taylor', ownerAvatarUrl: null, slug: 'starter', name: 'Starter', description: null, skillCount: 2, subscriberCount: 1, category: null }],
      total: 1,
      limit: 10,
      offset: 0,
    })
    vi.mocked(getSkillCatalog).mockResolvedValue({ skills: [], total: 0, limit: 10, offset: 0 })
    vi.mocked(getPeopleCatalog).mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 })
    vi.mocked(getDiscoverFeed).mockResolvedValue({
      events: [],
      followingCount: 0,
      view: 'discover',
      nextCursor: null,
    })

    const { HomeCatalogShelves } = await import('@/components/home/home-shelves')
    await HomeCatalogShelves({ viewerHandle: null })

    expect(getKitCatalog).toHaveBeenCalled()
    expect(getSkillCatalog).toHaveBeenCalled()
    expect(getPeopleCatalog).toHaveBeenCalled()
    expect(getDiscoverFeed).toHaveBeenCalled()
  })
})

describe('home personalized', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('fetches the following feed for the fresh shelf', async () => {
    const { getFeed, getPeopleCatalog } = await import('@/lib/registry')
    vi.mocked(getFeed).mockResolvedValue({
      events: [
        {
          kind: 'skill',
          type: 'published',
          actor: 'taylor',
          actorAvatarUrl: null,
          actorFollowers: 100,
          at: 1_700_000_000,
          skill: {
            author: 'taylor',
            slug: 'deploy-ritual',
            description: 'Checklist',
            category: 'ops',
            installs: 10,
            scan: 'clean',
            version: null,
            followedByYou: [],
            followedByYouCount: 0,
          },
        },
      ],
      followingCount: 1,
      view: 'following',
      nextCursor: null,
    })
    vi.mocked(getPeopleCatalog).mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 })

    const { HomeFreshShelf } = await import('@/components/home/home-personalized')
    await HomeFreshShelf()

    expect(getFeed).toHaveBeenCalledWith('following', { withSession: true })
  })
})

describe('shelf skeleton', () => {
  it('marks the fresh shelf skeleton as busy', async () => {
    const { FreshShelfSkeleton: Skeleton } = await import('@/components/home/shelf-skeleton')
    const html = renderToStaticMarkup(<Skeleton />)
    expect(html).toContain('aria-busy="true"')
  })

  it('renders catalog shelves before fresh in the loading shell', async () => {
    const { HomeLoadingShell } = await import('@/components/home/shelf-skeleton')
    const html = renderToStaticMarkup(<HomeLoadingShell />)
    const catalogIdx = html.indexOf('Loading catalog')
    const freshIdx = html.indexOf('Loading your feed')
    const blogIdx = html.indexOf('Loading blog')
    expect(catalogIdx).toBeGreaterThan(-1)
    expect(freshIdx).toBeGreaterThan(catalogIdx)
    expect(blogIdx).toBeGreaterThan(freshIdx)
  })
})
