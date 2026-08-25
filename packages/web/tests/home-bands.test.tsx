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
    const ladderAt = html.indexOf('Try anyone, install nothing')

    // Equal boxes above the catalog inverted the funnel. Below it they answer a
    // question the visitor has actually formed.
    expect(ladderAt).toBeGreaterThan(-1)
    expect(catalogAt).toBeLessThan(ladderAt)
  })

  it('runs the five rungs in ascending order of commitment', async () => {
    const html = await renderHome()

    // The same spine the docs and the README carry: borrow, keep, sync,
    // publish, team. The ORDER is the load-bearing part. Each rung has to cost
    // the reader more than the one before it, or the row is five claims rather
    // than a ladder, which is what it was when it ran sync, keep, team.
    const rungs = [
      'Try anyone, install nothing',
      'Follow people you trust',
      'One kit, every agent',
      'Publish your own',
      'Your team, one private kit',
    ].map((title) => ({ title, at: html.indexOf(title) }))

    for (const rung of rungs) expect(rung.at, rung.title).toBeGreaterThan(-1)
    for (let i = 1; i < rungs.length; i++) {
      expect(rungs[i - 1].at, `${rungs[i - 1].title} before ${rungs[i].title}`).toBeLessThan(
        rungs[i].at,
      )
    }
  })

  it('gives every rung the same shape', async () => {
    const html = await renderHome()

    // Title, body, button, five times. One rung carrying a command block
    // instead of a button made the row read as two things, and its wrapped
    // URL broke mid-handle.
    expect(html).toContain('How summoning works')
    expect(html).toContain('See the feed')
    expect(html).toContain('See the runtimes')
    expect(html).toContain('Start publishing')
    expect(html).toContain('Set up teams')
  })

  it('scrolls rather than shrinking to fit five rungs', async () => {
    const html = await renderHome()

    // Five equal columns in a 1120px band is ~224px each, against copy written
    // for a ~370px measure. The rail keeps the card width and moves the
    // overflow into its own scroll container, so the page never scrolls
    // sideways. `rail-scroll` is the class that hides the native bar.
    expect(html).toContain('rail-scroll')
    expect(html).toContain('overflow-x-auto')
  })

  it('does not repeat the hero install CTA', async () => {
    const html = await renderHome()

    // The lead rung was "Get app", which duplicates the Mac app door up top.
    expect(html).not.toContain('Bring your skills everywhere')
    expect(html).not.toContain('Get app')
  })
})

describe('the teams band', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('does not exist, because rung 5 already is it', async () => {
    const html = await renderHome()

    // A teams strip ran under the ladder so a team lead would not have to press
    // an arrow to reach rung 5. Scrolled to the end it sat directly under the
    // teams card restating it. The rung is the slot; a second copy of a rung is
    // not more reach, it is the same words twice.
    expect(html).toContain('Your team, one private kit')
    expect(html).not.toContain('Running Skillet with a team?')
    expect(html).not.toContain('Share skills your team cannot publish')
  })
})
