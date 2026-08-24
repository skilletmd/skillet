import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// The page is a static shell with Suspense holes for catalog data. Rendering the
// shell is enough to assert band order: the holes fall back to skeletons, which
// still occupy their position in the document.
vi.mock('@/lib/registry', () => ({
  getKitCatalog: vi.fn(async () => ({ items: [], total: 0, limit: 10, offset: 0 })),
  getSkillCatalog: vi.fn(async () => ({ skills: [], total: 0, limit: 10, offset: 0 })),
  getPeopleCatalog: vi.fn(async () => ({ items: [], total: 0, limit: 10, offset: 0 })),
  getDiscoverFeed: vi.fn(async () => ({
    events: [],
    followingCount: 0,
    view: 'discover',
    nextCursor: null,
  })),
  getFeed: vi.fn(),
  getFollowSuggestions: vi.fn(),
}))
vi.mock('@/lib/blog', () => ({ getAllPosts: vi.fn(() => []) }))
vi.mock('@/lib/get-session', () => ({ getSession: vi.fn() }))
vi.mock('@/components/kits/followed-curations-context', () => ({
  FollowedCurationsProvider: ({ children }: { children: React.ReactNode }) => children,
}))

async function renderHome() {
  const { default: Home } = await import('@/app/(consumer)/page')
  return renderToStaticMarkup(Home())
}

describe('homepage bands run discover then adopt', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('puts the borrow line in the hero and no install box with it', async () => {
    const html = await renderHome()

    const summonAt = html.indexOf('/summon and use their best skill')
    const installAt = html.indexOf('Install Skillet')

    expect(summonAt).toBeGreaterThan(-1)
    expect(installAt).toBeGreaterThan(-1)
    // The hero's promise is borrowing. An install box under it argued with the
    // sentence above it, so install now lives in the adopt band further down.
    expect(summonAt).toBeLessThan(installAt)
  })

  it('answers "who is on here" before it asks for an install', async () => {
    const html = await renderHome()

    const catalogAt = html.indexOf('surface-grid')
    const installAt = html.indexOf('Install Skillet')

    expect(catalogAt).toBeGreaterThan(-1)
    expect(catalogAt).toBeLessThan(installAt)
  })

  it('offers the install affordance exactly once', async () => {
    const html = await renderHome()

    expect(html.split('Install Skillet').length - 1).toBe(1)
  })

  it('drops the three-card ladder and its competing calls to action', async () => {
    const html = await renderHome()

    expect(html).not.toContain('Bring your skills everywhere')
    expect(html).not.toContain('See feed')
    expect(html).not.toContain('Set up teams')
  })

  it('shows the installed shorthand as the reason to adopt', async () => {
    const html = await renderHome()

    expect(html).toContain('/skillet @mattpocock review my PR')
  })
})
