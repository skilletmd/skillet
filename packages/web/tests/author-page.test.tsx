import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuthorPage, { generateMetadata } from '@/app/(consumer)/[author]/(profile)/page'

vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const mockGetAuthorProfile = vi.fn()
const mockAuth = vi.fn()
const mockGetAuthorKit = vi.fn()
const mockListMyOrgs = vi.fn()

vi.mock('@/lib/registry', () => ({
  getAllAuthorUsernames: vi.fn().mockResolvedValue(['test-author']),
  getAuthorProfile: (...args: unknown[]) => mockGetAuthorProfile(...args),
  // U7: generateMetadata reads the anonymous, request-deduped profile via
  // getAuthorProfileCached; route it to the same mocked profile.
  getAuthorProfileCached: (...args: unknown[]) => mockGetAuthorProfile(...args),
  getProfileActivity: vi.fn().mockResolvedValue([]),
}))

// Viewer identity now comes from the request-cached session
// via auth(), not a live /whoami round-trip — isAuthed/isSelf/viewerHandle are
// all derived from the mocked session below. next/headers is still stubbed
// since it's a request-scoped runtime primitive with no scope in tests.
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))

vi.mock('@/auth', () => ({
  auth: () => mockAuth(),
}))

vi.mock('@/lib/kits-server', () => ({
  getAuthorKit: (...args: unknown[]) => mockGetAuthorKit(...args),
}))

vi.mock('@/lib/orgs-server', () => ({
  listMyOrgs: (...args: unknown[]) => mockListMyOrgs(...args),
}))

vi.mock('@/components/kits/subscribe-author-button', () => ({
  SubscribeAuthorButton: () => null,
}))

vi.mock('@/components/team/profile-teams-section', () => ({
  ProfileTeamsSection: () => null,
}))

vi.mock('@/components/kits/profile-kits-section', () => ({
  ProfileKitsSection: () => null,
}))

const baseProfile = {
  username: 'test-author',
  displayName: 'Test Author',
  kind: 'user',
  bio: 'Author bio for public profile.',
  avatarUrl: 'https://example.com/avatar.png',
  profileUrl: 'https://example.com',
  totalInstalls: 1234,
  joinedAt: '2026-02-01T00:00:00Z',
  followers: 7,
  followedByMe: false,
  teams: [],
  skills: [
    {
      author: 'test-author',
      slug: 'test-skill',
      title: 'Test Skill',
      description: 'A useful published skill.',
      installCount: 42,
      latestVersion: '1.0.0',
      publishedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      versions: [],
    },
  ],
}

async function renderAuthorPage(author = 'test-author') {
  const jsx = await AuthorPage({
    params: Promise.resolve({ author }),
    searchParams: Promise.resolve({}),
  })
  return render(jsx)
}

describe('AuthorPage', () => {
  beforeEach(() => {
    mockGetAuthorProfile.mockReset()
    mockAuth.mockReset()
    mockAuth.mockResolvedValue({ handle: 'viewer' })
    mockGetAuthorKit.mockReset()
    mockGetAuthorKit.mockResolvedValue({
      kind: 'ok',
      kit: { owner: 'test-author', name: 'Test Author', skills: [], subscribed: false },
    })
    mockListMyOrgs.mockReset()
    mockListMyOrgs.mockResolvedValue({ kind: 'ok', orgs: [] })
  })

  it('requests the profile with the viewer session', async () => {
    mockGetAuthorProfile.mockResolvedValue(baseProfile)
    await renderAuthorPage()

    // Identity band, bio, stats, and sidebar are the shared (profile) layout's
    // job now — see profile-layout.test.tsx. This page owns the content column.
    expect(mockGetAuthorProfile).toHaveBeenCalledWith('test-author', { withSession: true })
  })

  it('renders published skills with install counts', async () => {
    mockGetAuthorProfile.mockResolvedValue(baseProfile)
    await renderAuthorPage()

    expect(screen.getByRole('heading', { name: /Skills 1/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Test Skill/ })).toHaveAttribute(
      'href',
      '/test-author/test-skill',
    )
    expect(screen.getByText('A useful published skill.')).toBeInTheDocument()
    // DirectoryCard shows installs as social proof: "Used by <count>".
    expect(screen.getByText('Used by 42')).toBeInTheDocument()
  })

  it('uses team language for team profile handles', async () => {
    mockGetAuthorProfile.mockResolvedValue({
      ...baseProfile,
      username: 'test',
      displayName: 'Test',
      kind: 'team',
      skills: [],
      totalInstalls: 0,
    })
    await renderAuthorPage('test')

    expect(screen.getByRole('heading', { name: /Skills 0/ })).toBeInTheDocument()
    // A bare profile (no saved, no activity) intentionally shows no tab bar —
    // a lone "Created" tab reads as chrome, so the content renders flat.
    expect(
      screen.getByText('No public team skills yet. Private team skills only appear to members.'),
    ).toBeInTheDocument()
  })

  it('shows owner-visible private skills with a private badge', async () => {
    mockGetAuthorProfile.mockResolvedValue({
      ...baseProfile,
      skills: [{ ...baseProfile.skills[0], visibility: 'private' }],
    })
    await renderAuthorPage()

    expect(screen.getByRole('link', { name: /Test Skill/ })).toHaveAttribute(
      'href',
      '/test-author/test-skill',
    )
    // The skill card renders a private VisibilityBadge (uppercased in CSS).
    expect(screen.getByText('private')).toBeInTheDocument()
  })

  it('does not show signing internals as profile stats', async () => {
    mockGetAuthorProfile.mockResolvedValue({
      ...baseProfile,
      skills: [
        { ...baseProfile.skills[0], signatureStatus: 'verified' },
        { ...baseProfile.skills[0], slug: 'second-skill', signatureStatus: 'unverified' },
      ],
    })
    await renderAuthorPage()

    expect(screen.queryByText('Signed')).not.toBeInTheDocument()
  })

  it('shows no create affordances even for the owner — creation lives in the nav +', async () => {
    mockAuth.mockResolvedValue({ handle: 'test-author', user: { id: 'u1' } })
    mockGetAuthorProfile.mockResolvedValue(baseProfile)
    await renderAuthorPage('test-author')

    // The profile shows you as others see you; section-level create links
    // were removed (2026-07-09). Empty states still carry the create path.
    expect(screen.queryByRole('link', { name: /New skill/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /New kit/ })).not.toBeInTheDocument()
  })

  it('hides owner create affordances when the session handle differs (not isSelf)', async () => {
    // Default mock session handle is 'viewer', not the route author.
    mockGetAuthorProfile.mockResolvedValue(baseProfile)
    await renderAuthorPage('test-author')

    expect(screen.queryByRole('link', { name: /New skill/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /New kit/ })).not.toBeInTheDocument()
  })

  it('generates author metadata', async () => {
    mockGetAuthorProfile.mockResolvedValue(baseProfile)
    await expect(
      generateMetadata({ params: Promise.resolve({ author: 'test-author' }) }),
    ).resolves.toMatchObject({
      title: 'Test Author (@test-author) · Skillet',
      description: 'Author bio for public profile.',
    })
  })
})
