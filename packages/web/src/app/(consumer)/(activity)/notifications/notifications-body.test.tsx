import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NotificationsBody } from './notifications-body'

// The pending-updates count comes from the shared useUnreadNotifications hook;
// mock it to a fixed value and test how the body composes.
const { mockCounts, mockMarkSeen } = vi.hoisted(() => ({
  mockCounts: { social: 0, updates: 0, total: 0 },
  mockMarkSeen: vi.fn(),
}))
vi.mock('@/components/notifications/use-unread-notifications', () => ({
  useUnreadNotifications: () => mockCounts,
  markUpdatesSeen: mockMarkSeen,
}))

describe('NotificationsBody', () => {
  it('renders a pending update as a notification row linking to Updates, and marks it seen', () => {
    mockCounts.updates = 2
    mockMarkSeen.mockClear()
    render(<NotificationsBody hasSocial={false}>{null}</NotificationsBody>)
    expect(screen.getByText('2 updates waiting for your review')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/updates')
    expect(mockMarkSeen).toHaveBeenCalled()
    // No empty state alongside the update row.
    expect(screen.queryByText(/No notifications yet/i)).not.toBeInTheDocument()
  })

  it('uses the singular for one update', () => {
    mockCounts.updates = 1
    render(<NotificationsBody hasSocial={false}>{null}</NotificationsBody>)
    expect(screen.getByText('1 update waiting for your review')).toBeInTheDocument()
  })

  it('shows the empty state only when there are no social events AND no updates', () => {
    mockCounts.updates = 0
    render(<NotificationsBody hasSocial={false}>{null}</NotificationsBody>)
    expect(screen.getByText(/No notifications yet/i)).toBeInTheDocument()
  })

  it('renders social rows (and no empty state) when social events exist', () => {
    mockCounts.updates = 0
    render(
      <NotificationsBody hasSocial>
        <li>a follow row</li>
      </NotificationsBody>,
    )
    expect(screen.getByText('a follow row')).toBeInTheDocument()
    expect(screen.queryByText(/No notifications yet/i)).not.toBeInTheDocument()
  })
})
