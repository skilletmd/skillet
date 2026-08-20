import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProfileHeader, ProfileAboutRail } from '@/components/profile-header'
import type { AuthorProfile } from '@/lib/types'

// next/link is a client primitive with no scope in jsdom — render it as a plain
// anchor so the header mounts. The FollowButton/ConnectAgentCta aren't exercised
// here (isSelf=true, isTeam=true suppress them), but the rendered profileUrl is.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

const baseProfile: AuthorProfile = {
  username: 'test-author',
  displayName: 'Test Author',
  kind: 'user',
  skills: [],
  totalInstalls: 0,
  joinedAt: '2026-02-01T00:00:00Z',
}

function renderSidebar(profileUrl?: string) {
  // The profileUrl renders in the About rail now — the guard under test moved
  // there with it.
  return render(<ProfileAboutRail profile={{ ...baseProfile, profileUrl }} isTeam />)
}

describe('ProfileHeader profileUrl href guard', () => {
  it('renders a javascript: profileUrl as inert text, never an anchor', () => {
    const { container } = renderSidebar('javascript:alert(1)')
    // No anchor carries the malicious href anywhere in the header.
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull()
    // The (display-only) label still appears, as plain text.
    expect(screen.getByText('javascript:alert(1)')).toBeInTheDocument()
    expect(screen.getByText('javascript:alert(1)').tagName).toBe('SPAN')
  })

  it('renders a data: URI profileUrl as inert text, never an anchor', () => {
    const { container } = renderSidebar('data:text/html,<script>alert(1)</script>')
    expect(container.querySelector('a[href^="data:"]')).toBeNull()
    const label = screen.getByText(/^data:text\/html/)
    expect(label.tagName).toBe('SPAN')
  })

  it('renders a valid https profileUrl as a working external link', () => {
    renderSidebar('https://example.com/me')
    // Label strips the scheme for display, but the href stays intact.
    const link = screen.getByRole('link', { name: 'example.com/me' })
    expect(link).toHaveAttribute('href', 'https://example.com/me')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders no profile link when profileUrl is empty or undefined', () => {
    const { container, rerender } = renderSidebar(undefined)
    expect(container.querySelector('a[target="_blank"]')).toBeNull()

    rerender(
      <ProfileHeader
        profile={{ ...baseProfile, profileUrl: '' }}
        author="test-author"
        isSelf
        isTeam
        isAuthed={false}
      />,
    )
    expect(container.querySelector('a[target="_blank"]')).toBeNull()
  })
})
