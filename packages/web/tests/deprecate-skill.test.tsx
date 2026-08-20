import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeprecatedBadge } from '@/components/deprecated-badge'
import {
  DeprecateSkillControl,
  DeprecateSkillPanel,
  isSkillOwner,
} from '@/components/deprecate-skill-control'

// --- mock the auth session (button visibility gate) ----------------------
const mockUseSession = vi.fn()
vi.mock('next-auth/react', () => ({
  useSession: () => mockUseSession(),
}))

// --- mock the lifecycle API client (we assert calls + drive error states) -
const mockDeprecate = vi.fn()
const mockUndeprecate = vi.fn()
vi.mock('@/lib/deprecation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/deprecation')>()
  return {
    ...actual,
    deprecateSkill: (...args: unknown[]) => mockDeprecate(...args),
    undeprecateSkill: (...args: unknown[]) => mockUndeprecate(...args),
  }
})

beforeEach(() => {
  mockUseSession.mockReset()
  mockDeprecate.mockReset()
  mockUndeprecate.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('isSkillOwner', () => {
  it('matches a signed-in handle to the skill author', () => {
    expect(isSkillOwner('taylor', 'taylor')).toBe(true)
    expect(isSkillOwner('marco', 'taylor')).toBe(false)
    expect(isSkillOwner(null, 'taylor')).toBe(false)
    expect(isSkillOwner(undefined, 'taylor')).toBe(false)
  })
})

describe('DeprecatedBadge', () => {
  it('renders a deprecated label', () => {
    render(<DeprecatedBadge />)
    expect(screen.getByText('deprecated')).toBeInTheDocument()
  })
})

describe('DeprecateSkillControl — visibility', () => {
  it('renders nothing for a non-owner', () => {
    mockUseSession.mockReturnValue({ status: 'authenticated', data: { handle: 'marco' } })
    const { container } = render(<DeprecateSkillControl author="taylor" slug="deploy-ritual" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a signed-out visitor', () => {
    mockUseSession.mockReturnValue({ status: 'unauthenticated', data: null })
    const { container } = render(<DeprecateSkillControl author="taylor" slug="deploy-ritual" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing while the session is loading', () => {
    mockUseSession.mockReturnValue({ status: 'loading', data: null })
    const { container } = render(<DeprecateSkillControl author="taylor" slug="deploy-ritual" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the deprecate control for the owner', () => {
    mockUseSession.mockReturnValue({ status: 'authenticated', data: { handle: 'taylor' } })
    render(<DeprecateSkillControl author="taylor" slug="deploy-ritual" />)
    expect(screen.getByRole('button', { name: 'Deprecate' })).toBeInTheDocument()
  })

  it('never renders a delete control (v1 has no hard delete)', () => {
    mockUseSession.mockReturnValue({ status: 'authenticated', data: { handle: 'taylor' } })
    render(<DeprecateSkillControl author="taylor" slug="deploy-ritual" />)
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument()
  })
})

describe('DeprecateSkillPanel — deprecate flow', () => {
  it('confirms via modal and sends the optional message', async () => {
    mockDeprecate.mockResolvedValue({ deprecated: true, message: 'Superseded by v2.' })
    render(<DeprecateSkillPanel author="taylor" slug="deploy-ritual" />)

    fireEvent.click(screen.getByRole('button', { name: 'Deprecate' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Message for the skill page/i), {
      target: { value: 'Superseded by v2.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Deprecate skill' }))

    await waitFor(() =>
      expect(mockDeprecate).toHaveBeenCalledWith('taylor', 'deploy-ritual', {
        message: 'Superseded by v2.',
      }),
    )
    // Modal closes and the deprecated state (badge + message) is shown.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('deprecated')).toBeInTheDocument()
    expect(screen.getByText('Superseded by v2.')).toBeInTheDocument()
  })

  it('cancelling the modal makes no API call', () => {
    render(<DeprecateSkillPanel author="taylor" slug="deploy-ritual" />)
    fireEvent.click(screen.getByRole('button', { name: 'Deprecate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockDeprecate).not.toHaveBeenCalled()
  })

  it('Escape closes the modal without firing deprecate', async () => {
    render(<DeprecateSkillPanel author="taylor" slug="deploy-ritual" />)
    fireEvent.click(screen.getByRole('button', { name: 'Deprecate' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockDeprecate).not.toHaveBeenCalled()
  })

  it('surfaces the registry error message and keeps the modal open', async () => {
    const { SkillLifecycleError } = await import('@/lib/deprecation')
    mockDeprecate.mockRejectedValue(
      new SkillLifecycleError('You don’t have permission to change this skill.', 'owner_only', 403),
    )
    render(<DeprecateSkillPanel author="taylor" slug="deploy-ritual" />)

    fireEvent.click(screen.getByRole('button', { name: 'Deprecate' }))
    fireEvent.click(screen.getByRole('button', { name: 'Deprecate skill' }))

    expect(
      await screen.findByText('You don’t have permission to change this skill.'),
    ).toBeInTheDocument()
    // Still deprecatable — the modal stays open so the owner can retry/cancel.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByText('deprecated')).not.toBeInTheDocument()
  })
})

describe('DeprecateSkillPanel — restore flow', () => {
  it('shows the deprecated state and restores', async () => {
    mockUndeprecate.mockResolvedValue({ deprecated: false, message: null })
    render(
      <DeprecateSkillPanel
        author="taylor"
        slug="deploy-ritual"
        initialDeprecated
        initialMessage="Old one."
      />,
    )

    expect(screen.getByText('deprecated')).toBeInTheDocument()
    expect(screen.getByText('Old one.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restore skill' }))
    await waitFor(() => expect(mockUndeprecate).toHaveBeenCalledWith('taylor', 'deploy-ritual'))
    await waitFor(() => expect(screen.queryByText('deprecated')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Deprecate' })).toBeInTheDocument()
  })
})
