import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  groupNotifications,
  NotificationRow,
  type ViewerAuthorKit,
} from '@/components/notifications/notification-row'
import type { NotificationEvent } from '@/lib/registry-notifications'

const authorKit: ViewerAuthorKit = {
  name: 'viewer',
  seed: 'viewer/kit',
  categories: [null],
  avatarUrl: null,
  initial: 'V',
}

function orgInvited(inviteId: string, orgSlug: string, orgName: string, at: number): NotificationEvent {
  return {
    kind: 'org_invited',
    at,
    inviteId,
    role: 'admin',
    org: { slug: orgSlug, name: orgName },
    inviter: 'owner',
  }
}

describe('org_invited notification row', () => {
  it('renders a View invitation link to the accept page with org + invite params', () => {
    const [group] = groupNotifications([orgInvited('inv-1', 'acme', 'Acme Corp', 100)])
    render(<NotificationRow group={group} viewerHandle="viewer" authorKit={authorKit} />)

    const link = screen.getByRole('link', { name: /view invitation/i })
    expect(link).toHaveAttribute('href', '/settings/teams/accept?org=acme&invite=inv-1')
    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument()
    expect(screen.getByText(/@owner/)).toBeInTheDocument()
    expect(screen.getByText(/as admin/)).toBeInTheDocument()
  })

  it('keeps two pending invites as two separate rows (never collapsed)', () => {
    const groups = groupNotifications([
      orgInvited('inv-1', 'acme', 'Acme Corp', 100),
      orgInvited('inv-2', 'globex', 'Globex', 200),
    ])
    expect(groups).toHaveLength(2)

    render(
      <ul>
        {groups.map((g) => (
          <NotificationRow key={g.orgInvite!.inviteId} group={g} viewerHandle="viewer" authorKit={authorKit} />
        ))}
      </ul>,
    )
    const links = screen.getAllByRole('link', { name: /view invitation/i })
    expect(links).toHaveLength(2)
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      // newest-first ordering from groupNotifications
      '/settings/teams/accept?org=globex&invite=inv-2',
      '/settings/teams/accept?org=acme&invite=inv-1',
    ])
  })
})
