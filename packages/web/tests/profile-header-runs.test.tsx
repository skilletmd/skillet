import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProfileHeader, ProfileAgentsRail } from '@/components/profile-header'
import type { AuthorProfile } from '@/lib/types'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

// The visitor view renders FollowButton, which calls useRouter — stub the router.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/test-author',
}))

const baseProfile: AuthorProfile = {
  username: 'test-author',
  displayName: 'Test Author',
  kind: 'user',
  skills: [],
  totalInstalls: 0,
  joinedAt: '2026-02-01T00:00:00Z',
}

function renderWith(profile: Partial<AuthorProfile>, isSelf = false) {
  return render(
    <>
      <ProfileHeader
        profile={{ ...baseProfile, ...profile }}
        author="test-author"
        isSelf={isSelf}
        isTeam={false}
        isAuthed={false}
      />
      <ProfileAgentsRail profile={{ ...baseProfile, ...profile }} />
    </>,
  )
}

describe('ProfileAgentsRail verified marks', () => {
  it('renders the curated runtimes as labeled rows; only device-detected ones say Verified', () => {
    renderWith({
      runtimes: [
        { key: 'cursor', verified: true },
        { key: 'figma', verified: false },
      ],
    })
    expect(screen.getByText('Cursor')).toBeInTheDocument()
    expect(screen.getByText('Figma')).toBeInTheDocument()
    expect(screen.getAllByText('Verified')).toHaveLength(1)
  })

  it('renders nothing for a visitor when the curated list is empty', () => {
    renderWith({ runtimes: [] })
    expect(screen.queryByText('Verified')).toBeNull()
    expect(screen.queryByText('Cursor')).toBeNull()
  })

  it('falls back to the legacy comma list when runtimes is absent', () => {
    renderWith({ runtimes: undefined, detectedRuntimes: ['cursor', 'claude-code'] })
    expect(screen.getByText('Cursor, Claude Code')).toBeInTheDocument()
    expect(screen.queryByText('Verified')).toBeNull()
  })
})
