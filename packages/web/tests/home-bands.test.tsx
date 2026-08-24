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

describe('the hero asks one thing', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('leads with the install doors', async () => {
    const html = await renderHome()

    const installAt = html.indexOf('Install Skillet')
    const catalogAt = html.indexOf('surface-grid')

    // Install is the hero's action now. The same four doors the kit page uses,
    // so "where do I put this" has one answer everywhere it is asked.
    expect(installAt).toBeGreaterThan(-1)
    expect(installAt).toBeLessThan(catalogAt)
  })

  it('offers all four doors, including the two that install nothing', async () => {
    const html = await renderHome()

    // The hero has room for the long form; the kit page's single row keeps
    // "Mac app". Server render has no UA, so it lands on Mac.
    expect(html).toContain('Download for Mac')
    expect(html).toContain('npx skilletmd')
    expect(html).toContain('ChatGPT')
    expect(html).toContain('Claude.ai')
  })

  it('sends a logged-out visitor to the docs rather than a server action', async () => {
    const html = await renderHome()

    // signedIn=false renders the cloud doors as plain links. That is what keeps
    // the hero session-free and fully prerendered; an expandable panel here
    // would call a server action a logged-out visitor cannot use.
    expect(html).toContain('/docs/mcp')
  })

  it('offers the install affordance exactly once', async () => {
    const html = await renderHome()

    expect(html.split('Install Skillet').length - 1).toBe(1)
  })
})

describe('the closing ladder', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('comes after the catalog, not before it', async () => {
    const html = await renderHome()

    const catalogAt = html.indexOf('surface-grid')
    const ladderAt = html.indexOf('Keep your team in sync')

    // Three equal boxes above the catalog inverted the funnel. Below it they
    // answer a question the visitor has actually formed.
    expect(ladderAt).toBeGreaterThan(-1)
    expect(catalogAt).toBeLessThan(ladderAt)
  })

  it('leads with reach, then follow, then team', async () => {
    const html = await renderHome()

    const reachAt = html.indexOf('One kit, every agent')
    const feedAt = html.indexOf('New skills from people you trust')
    const teamAt = html.indexOf('Keep your team in sync')

    expect(reachAt).toBeGreaterThan(-1)
    expect(reachAt).toBeLessThan(feedAt)
    expect(feedAt).toBeLessThan(teamAt)
  })

  it('does not argue with the hero it sits under', async () => {
    const html = await renderHome()

    // The hero asks for an install. A "borrow with nothing installed" rung
    // directly beneath it contradicted that, which is the same problem the
    // hero itself had before install moved into it.
    expect(html).not.toContain('Borrow with nothing installed')
  })

  it('does not repeat the hero install CTA', async () => {
    const html = await renderHome()

    // The lead rung was "Get app", which duplicates the Mac app door up top.
    // The borrow story took its place.
    expect(html).not.toContain('Bring your skills everywhere')
    expect(html).not.toContain('Get app')
  })

  it('gives all three rungs the same shape', async () => {
    const html = await renderHome()

    // Title, body, button, three times. One rung carrying a command block
    // instead of a button made the row read as two things, and its wrapped
    // URL broke mid-handle.
    expect(html).toContain('See the runtimes')
    expect(html).toContain('See feed')
    expect(html).toContain('Set up teams')
  })
})
