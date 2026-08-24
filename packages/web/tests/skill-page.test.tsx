import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import SkillPage, { generateMetadata } from '@/app/(consumer)/[author]/[skill]/page'

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  // The hero's Follow chip (FollowButton) calls useRouter for its optimistic refresh.
  useRouter: () => ({ refresh: () => {} }),
}))

// The page reads request headers to build the absolute README-badge origin.
// Tests render it outside a request scope, so stand in a minimal headers map.
vi.mock('next/headers', () => ({
  headers: () =>
    Promise.resolve(
      new Map([
        ['x-forwarded-host', 'skillet.md'],
        ['x-forwarded-proto', 'https'],
      ]),
    ),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

// The page-foot ReportDialog is a client component that reads the auth session;
// stand in an unauthenticated session so it renders outside a SessionProvider.
vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: null, status: 'unauthenticated' }),
}))

vi.mock('@/auth', () => ({
  auth: vi.fn().mockResolvedValue({ handle: 'test-author' }),
}))

const mockGetSkill = vi.fn()
const mockGetSkillTombstone = vi.fn().mockResolvedValue(null)

vi.mock('@/lib/registry', () => ({
  getSkill: (...args: unknown[]) => mockGetSkill(...args),
  getSkillTombstone: (...args: unknown[]) => mockGetSkillTombstone(...args),
  getAllSkillSlugs: vi.fn().mockResolvedValue([]),
  getKitsForSkill: vi.fn().mockResolvedValue([]),
  getAuthorProfile: vi.fn().mockResolvedValue(null),
  getSkillCatalog: vi.fn().mockResolvedValue({ skills: [], total: 0, limit: 8, offset: 0 }),
}))

const mockGetSkillBundleSummary = vi.fn()

vi.mock('@/lib/skill-bundle-content', () => ({
  getSkillBundleSummary: (...args: unknown[]) => mockGetSkillBundleSummary(...args),
}))

// The owner-only proposal notice does its own client-side fetch on mount; it's
// covered by proposal-notifications.test.tsx. Stub it here so these page tests
// stay focused on page content (and don't emit act() warnings for its effect).
vi.mock('@/components/owner-proposal-alerts', () => ({
  OwnerProposalAlerts: () => null,
}))

vi.mock('@/components/proposed-changes', () => ({
  ProposedChanges: () => null,
}))

// The owner-only deprecate control reads the auth session and renders nothing
// for non-owners; it's covered by deprecate-skill.test.tsx. Stub it here so the
// page tests don't need a SessionProvider.
vi.mock('@/components/deprecate-skill-control', () => ({
  DeprecateSkillControl: () => null,
}))

vi.mock('@/components/kits/kits-membership-shell', () => ({
  KitsMembershipShell: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('@/components/propose-update-link', () => ({
  ProposeUpdateLink: () => null,
}))

vi.mock('@/components/add-to-kit-button', () => ({
  AddToKitButton: () => (
    <div aria-label="Install skill">
      <button type="button">Add</button>
    </div>
  ),
  CliInstall: ({ refName }: { refName: string }) => (
    <details open>
      <summary>CLI install</summary>
      <span>skillet add {refName}</span>
    </details>
  ),
}))

// Semver-labeled shape — what the registry mapper produces when the server
// sends `version_label` (registry semver, R6/R7).
const baseSkill = {
  author: 'test-author',
  slug: 'test-skill',
  title: 'Test Skill',
  description: 'A test skill description.',
  installCount: 42,
  latestVersion: 'v1.0.0',
  publishedAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  tags: ['testing'],
  versions: [
    { version: 'v1.0.0', publishedAt: '2026-01-01T00:00:00Z', changelog: 'Initial release' },
  ],
}

async function renderSkillPage(author = 'test-author', slug = 'test-skill') {
  const jsx = await SkillPage({
    params: Promise.resolve({ author, skill: slug }),
  })
  return render(jsx)
}

describe('SkillPage', () => {
  beforeEach(() => {
    mockGetSkillBundleSummary.mockResolvedValue(null)
  })

  it('renders skill title as heading', async () => {
    mockGetSkill.mockResolvedValue(baseSkill)
    await renderSkillPage()
    expect(screen.getByRole('heading', { level: 1, name: 'Test Skill' })).toBeInTheDocument()
  })

  it('renders skill description', async () => {
    mockGetSkill.mockResolvedValue(baseSkill)
    await renderSkillPage()
    expect(screen.getByText('A test skill description.')).toBeInTheDocument()
  })

  it('renders the Used-by social proof from the used-by count', async () => {
    // Used-by reflects curators (usedByCount), not raw installs — the sidebar
    // section leads with a "Used by" eyebrow and a live count beneath it.
    mockGetSkill.mockResolvedValue({ ...baseSkill, usedByCount: 7 })
    await renderSkillPage()
    // Rendered twice — the desktop rail copy and the mobile up-top copy (each
    // hidden at the other breakpoint), so assert presence, not uniqueness.
    expect(screen.getAllByText('Used by').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/7 people/).length).toBeGreaterThan(0)
  })

  it('renders the semver label in version history when the registry sent one', async () => {
    mockGetSkill.mockResolvedValue(baseSkill)
    await renderSkillPage()
    // Twice by design: the About rail's version line and the history row.
    expect(screen.getAllByText('v1.0.0')).toHaveLength(2)
  })

  it('falls back to positional vN history rows on registries without semver labels', async () => {
    mockGetSkill.mockResolvedValue({
      ...baseSkill,
      latestVersion: 'v2',
      versions: [
        { version: 'v2', publishedAt: '2026-01-02T00:00:00Z' },
        { version: 'v1', publishedAt: '2026-01-01T00:00:00Z', changelog: 'Initial release' },
      ],
    })
    await renderSkillPage()
    // Latest appears twice (About rail + history); older versions once.
    expect(screen.getAllByText('v2')).toHaveLength(2)
    expect(screen.getByText('v1')).toBeInTheDocument()
  })

  it('does not offer install before the skill is added', async () => {
    mockGetSkill.mockResolvedValue(baseSkill)
    await renderSkillPage()

    // The standalone panel that always sat below the content is gone. Install is
    // the second half of Add now, the same as on a kit page: a visitor who has
    // not added anything has nowhere to install it to, so a command here was
    // answering a question they had not asked yet.
    const matches = screen.queryAllByText((_content, el) =>
      Boolean(el?.textContent?.includes('npx skilletmd add @test-author/test-skill -y')),
    )
    expect(matches.length).toBe(0)
  })

  it('renders the install control (CLI now lives inside it)', async () => {
    mockGetSkill.mockResolvedValue(baseSkill)
    await renderSkillPage()
    // The standalone CLI panel is gone — install is one control; the CLI command
    // is folded into the Add dropdown (covered by skill-kit-control tests).
    expect(screen.getByLabelText('Install skill')).toBeInTheDocument()
  })

  it('shows runtime reach as a "Works with" rail link to the runtimes doc', async () => {
    mockGetSkill.mockResolvedValue(baseSkill)
    await renderSkillPage()
    expect(screen.queryByText('Compatible with')).not.toBeInTheDocument()
    // Moved out of the hero into the sidebar rail ("Works with" eyebrow).
    expect(screen.getByText('Works with')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Claude, Codex, Cursor/ })).toHaveAttribute(
      'href',
      '/docs/runtimes',
    )
  })

  it('renders version history as a disclosure', async () => {
    mockGetSkill.mockResolvedValue(baseSkill)
    await renderSkillPage()
    expect(screen.getByText('Version history')).toBeInTheDocument()
    expect(screen.getByText('Initial release')).toBeInTheDocument()
  })

  it('includes author breadcrumb link to author profile', async () => {
    mockGetSkill.mockResolvedValue(baseSkill)
    await renderSkillPage()
    // Two now, and deliberately: the byline is attribution above the title,
    // the rail's About row is the identity card. Both route to the profile.
    const links = screen.getAllByRole('link', { name: '@test-author' })
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) expect(link).toHaveAttribute('href', '/test-author')
  })

  it('drops the published date from the header meta (it lives in version history)', async () => {
    mockGetSkill.mockResolvedValue(baseSkill)
    await renderSkillPage()
    expect(screen.queryByText(/published [A-Z]/)).not.toBeInTheDocument()
    // Version history is still present to carry the date/changelog.
    expect(screen.getByText('Version history')).toBeInTheDocument()
  })

  it('renders a signed chip only when signatureStatus is verified', async () => {
    mockGetSkill.mockResolvedValue({ ...baseSkill, signatureStatus: 'verified' })
    await renderSkillPage()
    expect(screen.getByText('signed')).toHaveAttribute(
      'title',
      expect.stringContaining('Ed25519 signature'),
    )
  })

  it('renders no signed chip when signatureStatus is unverified', async () => {
    mockGetSkill.mockResolvedValue({ ...baseSkill, signatureStatus: 'unverified' })
    await renderSkillPage()
    expect(screen.queryByText('signed')).not.toBeInTheDocument()
  })

  it('renders no signed chip when signatureStatus is missing', async () => {
    mockGetSkill.mockResolvedValue({ ...baseSkill, signatureStatus: undefined })
    await renderSkillPage()
    expect(screen.queryByText('signed')).not.toBeInTheDocument()
  })

  // --- Live-data edge cases ---

  it('renders cleanly when description is empty (no empty paragraph)', async () => {
    mockGetSkill.mockResolvedValue({ ...baseSkill, description: '' })
    await renderSkillPage()
    expect(screen.queryByText('A test skill description.')).not.toBeInTheDocument()
    // Heading still renders; page does not crash.
    expect(screen.getByRole('heading', { level: 1, name: 'Test Skill' })).toBeInTheDocument()
  })

  it('hides the version-history disclosure when there are no versions', async () => {
    mockGetSkill.mockResolvedValue({ ...baseSkill, versions: [], latestVersion: 'latest' })
    await renderSkillPage()
    expect(screen.queryByText('Version history')).not.toBeInTheDocument()
    expect(screen.queryByText('Initial release')).not.toBeInTheDocument()
  })

  it('never renders a doubled or "vlatest" version label in the meta row', async () => {
    mockGetSkill.mockResolvedValue({ ...baseSkill, latestVersion: 'latest' })
    await renderSkillPage()
    expect(screen.queryByText('vlatest')).not.toBeInTheDocument()
  })

  it('renders SKILL.md body when bundle content is available', async () => {
    mockGetSkill.mockResolvedValue(baseSkill)
    mockGetSkillBundleSummary.mockResolvedValue({
      versionHash: 'sha256:abc',
      skillMdBody: '## Limites\n\nNão invente alertas.',
      frontmatter: 'name: test-skill',
      files: [{ path: 'SKILL.md', kind: 'text', text: '---\nname: test\n---\n\n## Limites' }],
    })
    await renderSkillPage()
    expect(screen.getByText('SKILL.md')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Limites' })).toBeInTheDocument()
    expect(screen.getByText('Não invente alertas.')).toBeInTheDocument()
  })

  // Owner's view of their own deprecated skill (U2). getSkill returns the skill
  // only for a manager, so reaching SkillPageView with deprecated:true implies
  // the owner path.
  describe('deprecated (owner view)', () => {
    it('shows the deprecated badge + banner and hides every install path', async () => {
      mockGetSkill.mockResolvedValue({ ...baseSkill, deprecated: true })
      await renderSkillPage()
      expect(screen.getByText('deprecated')).toBeInTheDocument()
      expect(screen.getByText(/This skill is deprecated/)).toBeInTheDocument()
      // No Add-to-kit, no install command.
      expect(screen.queryByLabelText('Install skill')).not.toBeInTheDocument()
      expect(
        screen.queryByText((_c, el) => Boolean(el?.textContent?.includes('npx skilletmd add'))),
      ).not.toBeInTheDocument()
    })

    it('renders the owner sunset message inside the banner', async () => {
      mockGetSkill.mockResolvedValue({
        ...baseSkill,
        deprecated: true,
        deprecationMessage: 'Moved to @test-author/test-skill-v2.',
      })
      await renderSkillPage()
      expect(screen.getByText('Moved to @test-author/test-skill-v2.')).toBeInTheDocument()
    })

    it('keeps the install path for a non-deprecated skill (regression)', async () => {
      mockGetSkill.mockResolvedValue(baseSkill)
      await renderSkillPage()
      expect(screen.getByLabelText('Install skill')).toBeInTheDocument()
      expect(screen.queryByText('deprecated')).not.toBeInTheDocument()
    })
  })

  // generateMetadata (U4/R5): a deprecated skill's tombstone is de-indexed.
  describe('generateMetadata — deprecation', () => {
    const meta = (author = 'test-author', slug = 'test-skill') =>
      generateMetadata({ params: Promise.resolve({ author, skill: slug }) })

    it('marks a deprecated skill noindex', async () => {
      mockGetSkill.mockResolvedValue(null)
      mockGetSkillTombstone.mockResolvedValueOnce({ message: 'gone', deprecatedAt: null })
      const m = await meta()
      expect(m.robots).toEqual({ index: false, follow: false })
      expect(String(m.title)).toContain('deprecated')
    })

    it('returns empty metadata for a genuinely missing skill', async () => {
      mockGetSkill.mockResolvedValue(null)
      mockGetSkillTombstone.mockResolvedValueOnce(null)
      expect(await meta()).toEqual({})
    })

    it('does not mark a live skill noindex', async () => {
      mockGetSkill.mockResolvedValue(baseSkill)
      const m = await meta()
      expect(m.robots).toBeUndefined()
    })
  })
})
