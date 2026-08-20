import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationRow, groupNotifications } from '@/components/notifications/notification-row'
import { MarkNotificationsSeen } from './mark-seen'
import type { NotificationEvent } from '@/lib/registry-notifications'

function renderRow(event: NotificationEvent) {
  return render(
    <ul>
      <NotificationRow
        group={groupNotifications([event])[0]}
        viewerHandle="me"
        authorKit={{ name: 'Me', seed: 'me/x', categories: [], avatarUrl: null, initial: 'ME' }}
      />
    </ul>,
  )
}

describe('NotificationRow', () => {
  it('renders a followed_you row with the actor link and relative time', () => {
    const { container } = renderRow({
      kind: 'followed_you',
      actor: 'bob',
      actorAvatarUrl: null,
      at: 1_700_000_000,
    })
    expect(screen.getByText('followed you')).toBeInTheDocument()
    // The actor handle links to their profile.
    const links = screen.getAllByRole('link', { name: /bob/ })
    expect(links.some((a) => a.getAttribute('href') === '/bob')).toBe(true)
    expect(screen.getByText(/@bob/)).toBeInTheDocument()
    expect(container.querySelector('time')).not.toBeNull()
  })

  it('renders a subscribed_author row with the viewer author-kit tile', () => {
    renderRow({ kind: 'subscribed_author', actor: 'bob', actorAvatarUrl: null, at: 1_700_000_000 })
    expect(screen.getByText('added your kit')).toBeInTheDocument()
    const kitLink = screen.getByRole('link', { name: /Me/ })
    expect(kitLink).toHaveAttribute('href', '/me/kit')
  })

  it('renders an installed_skill row with the skill tile linked', () => {
    renderRow({
      kind: 'installed_skill',
      actor: 'bob',
      actorAvatarUrl: null,
      at: 1_700_000_000,
      skill: {
        skillId: 'me:tool',
        slug: 'my-tool',
        author: 'me',
        category: 'ai',
        href: '/me/my-tool',
      },
    })
    expect(screen.getByText('added your skill')).toBeInTheDocument()
    const skillLink = screen.getByRole('link', { name: /My Tool/ })
    expect(skillLink).toHaveAttribute('href', '/me/my-tool')
  })

  it('renders a subscribed_kit row with the kit linking through', () => {
    renderRow({
      kind: 'subscribed_kit',
      actor: 'bob',
      actorAvatarUrl: null,
      at: 1_700_000_000,
      kit: {
        kitId: 'k1',
        name: 'Ship Review',
        owner: 'grace',
        href: '/grace/kit/ship-review',
        skillCount: 4,
        description: null,
      },
    })
    expect(screen.getByText('added your kit')).toBeInTheDocument()
    const kitLink = screen.getByRole('link', { name: /Ship Review/ })
    expect(kitLink).toHaveAttribute('href', '/grace/kit/ship-review')
  })

  it('renders a version_blocked system row — no actor, skill linked, calm copy', () => {
    renderRow({
      kind: 'version_blocked',
      at: 1_700_000_000,
      reason: 'quarantined',
      skill: { skillId: 'me:tool', slug: 'my-tool', author: 'me', category: 'ai', href: '/me/my-tool' },
    })
    expect(screen.getByText(/was blocked by the scanner/)).toBeInTheDocument()
    expect(screen.getByText(/pulled from installs/)).toBeInTheDocument()
    // No actor facepile — there's no person to link to.
    expect(screen.queryByText(/@/)).not.toBeInTheDocument()
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('href', '/me/my-tool')
  })
})

describe('MarkNotificationsSeen', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fires the seen POST exactly once on mount', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)

    const { container } = render(<MarkNotificationsSeen />)
    expect(container).toBeEmptyDOMElement()

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('me/notifications/seen')
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' })
  })
})
