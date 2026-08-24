import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { AuthorProfile } from '@/lib/types'

vi.mock('@/components/follow-button', () => ({
  FollowButton: () => null,
}))
vi.mock('@/components/connect-agent-cta', () => ({
  ConnectAgentCta: () => null,
}))

import { ProfileHeader } from '@/components/profile-header'
import { MirrorProfileCard } from '@/components/mirror-notice'

function profile(over: Partial<AuthorProfile> = {}): AuthorProfile {
  return {
    username: 'every',
    displayName: 'Every',
    bio: null,
    avatarUrl: null,
    joinedAt: '2026-08-01T00:00:00.000Z',
    skills: [],
    totalInstalls: 0,
    followers: 0,
    following: 0,
    isMirror: true,
    mirrorSourceUrl: 'https://github.com/EveryInc/compound-engineering-plugin',
    ...over,
  } as AuthorProfile
}

function header(p: AuthorProfile) {
  return renderToStaticMarkup(
    ProfileHeader({ profile: p, author: p.username, isSelf: false, isTeam: false, isAuthed: false }),
  )
}

describe('a mirrored profile states its source without qualifying the person', () => {
  it('renders no Mirror badge beside the display name', () => {
    const html = header(profile())

    expect(html).toContain('Every')
    expect(html).not.toContain('>Mirror<')
  })

  it('labels the rail block Source and keeps the repo and claim path in it', () => {
    const html = renderToStaticMarkup(
      MirrorProfileCard({
        sourceUrl: 'https://github.com/EveryInc/compound-engineering-plugin',
        license: 'MIT',
        children: 'claim slot',
      }),
    )

    expect(html).toContain('Source')
    expect(html).toContain('EveryInc/compound-engineering-plugin')
    expect(html).toContain('claim slot')
    // "Mirror" still faintly means "not the real one"; the block answers where
    // the data came from.
    expect(html).not.toContain('>Mirror<')
  })
})

describe('the header prints no zero counts', () => {
  it('omits followers and installs when both are zero', () => {
    const html = header(profile())

    expect(html).not.toContain('followers')
    expect(html).not.toContain('installs')
  })

  it('shows them once they are real, and reads singular at one', () => {
    const many = header(profile({ followers: 7, totalInstalls: 12, isMirror: false }))
    expect(many).toContain('followers')
    expect(many).toContain('installs')

    const one = header(profile({ followers: 1, totalInstalls: 1, isMirror: false }))
    expect(one).toContain('follower<')
    expect(one).toContain('install<')
  })
})
