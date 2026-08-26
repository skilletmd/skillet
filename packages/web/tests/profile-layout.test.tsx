import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileLayout from '@/app/(consumer)/[author]/(profile)/layout'

// The identity band (name, @handle, bio, stats, avatar) and the sidebar rail
// live in the shared (profile) layout — the profile page and its
// followers/following/installs routes all render inside it, so this covers the
// shell they share. Page-specific content is covered in author-page.test.tsx.

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
const mockListMyOrgs = vi.fn()

vi.mock('@/lib/registry', () => ({
  getAuthorProfile: (...args: unknown[]) => mockGetAuthorProfile(...args),
}))

vi.mock('@/auth', () => ({
  auth: () => mockAuth(),
}))

vi.mock('@/lib/orgs-server', () => ({
  listMyOrgs: (...args: unknown[]) => mockListMyOrgs(...args),
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
  skills: [],
}

async function renderLayout(author = 'test-author') {
  const jsx = await ProfileLayout({
    children: <div data-testid="child">child column</div>,
    params: Promise.resolve({ author }),
  })
  return render(jsx)
}

describe('ProfileLayout', () => {
  beforeEach(() => {
    mockGetAuthorProfile.mockReset()
    mockAuth.mockReset()
    mockAuth.mockResolvedValue({ handle: 'viewer' })
    mockListMyOrgs.mockReset()
    mockListMyOrgs.mockResolvedValue({ kind: 'ok', orgs: [] })
  })

  it('renders the shared identity band and bio', async () => {
    mockGetAuthorProfile.mockResolvedValue(baseProfile)
    await renderLayout()

    expect(mockGetAuthorProfile).toHaveBeenCalledWith('test-author', { withSession: true })
    expect(screen.getByRole('heading', { level: 1, name: 'Test Author' })).toBeInTheDocument()
    expect(screen.getAllByText('@test-author').length).toBeGreaterThan(0)
    expect(screen.getByText('Author bio for public profile.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'example.com' })).toHaveAttribute(
      'href',
      'https://example.com',
    )
    // Two copies of the photo, one visible at a time: the rail's (from lg) and
    // the identity's small one (below lg). Both carry the alt text — whichever
    // is rendered has to name the person.
    const avatars = screen.getAllByAltText('Test Author')
    expect(avatars).toHaveLength(2)
    for (const img of avatars) {
      expect(img).toHaveAttribute('src', 'https://example.com/avatar.png')
    }
  })

  it('renders public stats and the joined date', async () => {
    mockGetAuthorProfile.mockResolvedValue(baseProfile)
    await renderLayout()

    expect(screen.getByText('1.2K')).toBeInTheDocument()
    expect(screen.getByText(/February 2026/)).toBeInTheDocument()
  })

  it('renders the page column into the shell', async () => {
    mockGetAuthorProfile.mockResolvedValue(baseProfile)
    await renderLayout()

    expect(screen.getByTestId('child')).toBeInTheDocument()
  })

  it('does not duplicate dashboard navigation in the profile sidebar', async () => {
    mockGetAuthorProfile.mockResolvedValue(baseProfile)
    await renderLayout()

    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Account settings' })).not.toBeInTheDocument()
  })

  it('does not duplicate team settings navigation on team profiles', async () => {
    mockGetAuthorProfile.mockResolvedValue({
      ...baseProfile,
      username: 'test',
      displayName: 'Test',
      kind: 'team',
    })
    await renderLayout('test')

    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Team settings' })).not.toBeInTheDocument()
  })
})
