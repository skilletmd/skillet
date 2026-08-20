import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NotificationBell } from '@/components/notifications/notification-bell'

// The count comes from the shared useUnreadNotifications hook; here we mock it to a
// fixed value and test the bell's rendering. The fetch/dedupe behavior is covered
// in use-unread-notifications.test.ts.
const { mockUnread } = vi.hoisted(() => ({ mockUnread: { value: 0 } }))
vi.mock('@/components/notifications/use-unread-notifications', () => ({
  useUnreadNotifications: () => ({ social: mockUnread.value, updates: 0, total: mockUnread.value }),
}))

describe('NotificationBell', () => {
  it('shows a badge with the unread count and links to /notifications', () => {
    mockUnread.value = 3
    render(<NotificationBell />)
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByRole('link')).toHaveAttribute('href', '/notifications')
    expect(screen.getByLabelText(/3 unread/)).toBeInTheDocument()
  })

  it('caps the badge at 9+', () => {
    mockUnread.value = 42
    render(<NotificationBell />)
    expect(screen.getByText('9+')).toBeInTheDocument()
  })

  it('renders no badge at zero', () => {
    mockUnread.value = 0
    const { container } = render(<NotificationBell />)
    expect(container.querySelector('span')).toBeNull()
    expect(screen.getByLabelText('Notifications')).toBeInTheDocument()
  })
})
