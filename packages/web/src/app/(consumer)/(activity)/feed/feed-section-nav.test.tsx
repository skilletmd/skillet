import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FeedMobileBar, FeedSectionNav } from './feed-tabs'

const { mockCounts, mockPathname, mockSessionStatus } = vi.hoisted(() => ({
  mockCounts: { social: 0, updates: 0, total: 0 },
  mockPathname: { value: '/feed' },
  mockSessionStatus: { value: 'authenticated' as 'authenticated' | 'unauthenticated' },
}))

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname.value,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: mockSessionStatus.value }),
}))

vi.mock('@/components/notifications/use-unread-notifications', () => ({
  useUnreadNotifications: () => ({
    social: mockCounts.social,
    updates: mockCounts.updates,
    total: mockCounts.total,
  }),
}))

describe('FeedSectionNav', () => {
  it('shows Updates with badge when pending count is greater than zero', () => {
    mockSessionStatus.value = 'authenticated'
    mockPathname.value = '/feed'
    mockCounts.social = 0
    mockCounts.updates = 3
    mockCounts.total = 3

    render(<FeedSectionNav />)

    const updates = screen.getByRole('link', { name: /updates/i })
    expect(updates).toHaveAttribute('href', '/updates')
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('always shows Updates (no badge) when pending count is zero', () => {
    mockSessionStatus.value = 'authenticated'
    mockPathname.value = '/feed'
    mockCounts.social = 2
    mockCounts.updates = 0
    mockCounts.total = 2

    render(<FeedSectionNav />)

    expect(screen.getByRole('link', { name: /updates/i })).toHaveAttribute('href', '/updates')
    expect(screen.queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /notifications/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^feed$/i })).toBeInTheDocument()
  })
})

describe('FeedMobileBar', () => {
  it('carries both axes — lenses and sections — in one bar, with Updates badged when pending', () => {
    mockSessionStatus.value = 'authenticated'
    mockPathname.value = '/feed'
    mockCounts.social = 0
    mockCounts.updates = 3

    render(<FeedMobileBar />)

    expect(screen.getByRole('link', { name: /for you/i })).toHaveAttribute('href', '/feed')
    expect(screen.getByRole('link', { name: /global/i })).toHaveAttribute('href', '/feed/global')
    expect(screen.getByRole('link', { name: /notifications/i })).toHaveAttribute(
      'href',
      '/notifications',
    )
    expect(screen.getByRole('link', { name: /updates/i })).toHaveAttribute('href', '/updates')
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('keeps Updates (unbadged) when the queue is empty, alongside lenses + Notifications', () => {
    mockSessionStatus.value = 'authenticated'
    mockPathname.value = '/notifications'
    mockCounts.social = 0
    mockCounts.updates = 0

    render(<FeedMobileBar />)

    expect(screen.getByRole('link', { name: /global/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /notifications/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /updates/i })).toBeInTheDocument()
  })

  it('drops the section tabs for logged-out viewers (lens-only)', () => {
    mockSessionStatus.value = 'unauthenticated'
    mockPathname.value = '/feed/global'
    mockCounts.updates = 2

    render(<FeedMobileBar />)

    expect(screen.getByRole('link', { name: /global/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /for you/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /notifications/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /updates/i })).not.toBeInTheDocument()
  })
})
