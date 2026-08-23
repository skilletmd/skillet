import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// The For-you lens is the bare /feed, which is also the "For you" tab's href. An
// empty following feed used to redirect to /feed/global, which made that tab
// impossible to open — you bounced to Global with no explanation and no way to
// find people to follow. These lock the empty state in place of that redirect.

const redirect = vi.fn(() => {
  throw new Error('ForYouSurface must not redirect')
})
vi.mock('next/navigation', () => ({ redirect }))

const getFeed = vi.fn()
const getFollowSuggestions = vi.fn()
vi.mock('@/lib/registry', () => ({
  getFeed: (...args: unknown[]) => getFeed(...args),
  getDiscoverFeed: vi.fn(async () => ({ events: [], nextCursor: null })),
  getFollowSuggestions: (...args: unknown[]) => getFollowSuggestions(...args),
}))

vi.mock('@/lib/get-session', () => ({
  getSession: async () => ({ user: { name: 'Taylor' }, handle: 'taylor' }),
}))

vi.mock('@/lib/orgs-server', () => ({ listMyOrgs: async () => ({ kind: 'ok', orgs: [] }) }))

vi.mock('@/components/follow-button', () => ({
  FollowButton: ({ author }: { author: string }) => <button>Follow {author}</button>,
}))

const { ForYouSurface } = await import('@/app/(consumer)/(activity)/feed/for-you-surface')

describe('empty For-you feed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getFeed.mockResolvedValue({ events: [], nextCursor: null })
    getFollowSuggestions.mockResolvedValue([
      { handle: 'karpathy', name: 'Andrej', avatarUrl: null, skills: 4, followers: 12 },
    ])
  })

  it('renders its own empty state instead of redirecting to Global', async () => {
    render(await ForYouSurface({}))
    expect(redirect).not.toHaveBeenCalled()
    expect(screen.getByText('Your feed is empty')).toBeTruthy()
  })

  it('offers a way out: who to follow, plus the global feed', async () => {
    render(await ForYouSurface({}))
    expect(screen.getByText('@karpathy · 4 skills')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Browse the global feed' })).toBeTruthy()
  })

  it('still renders the empty state when there is no one to suggest', async () => {
    getFollowSuggestions.mockResolvedValue([])
    render(await ForYouSurface({}))
    expect(redirect).not.toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Browse the global feed' })).toBeTruthy()
  })

  it('does not fetch suggestions when the feed has events', async () => {
    getFeed.mockResolvedValue({
      events: [
        {
          id: '1',
          kind: 'skill',
          actor: 'taylor',
          at: '2026-08-23T00:00:00Z',
          skill: { author: 'taylor', slug: 'demo', version: '1.0.0' },
        },
      ],
      nextCursor: null,
    })
    await ForYouSurface({})
    expect(getFollowSuggestions).not.toHaveBeenCalled()
  })
})
