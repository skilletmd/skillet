// Choose-username card: validating claim form that refreshes the
// session on success. claim-handle and the next-auth/next-navigation hooks are
// mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ChooseUsername } from '@/components/choose-username'

const claimHandle = vi.fn()
const update = vi.fn()
const refresh = vi.fn()

vi.mock('@/lib/claim-handle', async () => {
  const actual = await vi.importActual<typeof import('@/lib/claim-handle')>('@/lib/claim-handle')
  return { ...actual, claimHandle: (...a: unknown[]) => claimHandle(...a) }
})
vi.mock('next-auth/react', () => ({ useSession: () => ({ update }) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

beforeEach(() => {
  claimHandle.mockReset()
  update.mockReset()
  refresh.mockReset()
  claimHandle.mockResolvedValue(undefined)
})

describe('ChooseUsername', () => {
  it('shows an inline validation error for an invalid handle', async () => {
    render(<ChooseUsername />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: '-bad' } })
    fireEvent.click(screen.getByRole('button', { name: 'Claim username' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/start/i))
    expect(claimHandle).not.toHaveBeenCalled()
  })

  it('claims, refreshes the session, and re-renders on success', async () => {
    render(<ChooseUsername />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } })
    fireEvent.click(screen.getByRole('button', { name: 'Claim username' }))

    await waitFor(() => expect(claimHandle).toHaveBeenCalledWith('alice', { brandEligible: [] }))
    await waitFor(() => expect(update).toHaveBeenCalled())
    expect(refresh).toHaveBeenCalled()
  })

  it('surfaces a server error and stays on the form', async () => {
    claimHandle.mockRejectedValue(new Error('That username is already taken. Try another.'))
    render(<ChooseUsername />)
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'taken' } })
    fireEvent.click(screen.getByRole('button', { name: 'Claim username' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/already taken/i))
    expect(refresh).not.toHaveBeenCalled()
  })

  it('normalizes input to lowercase handle characters', () => {
    render(<ChooseUsername />)
    const input = screen.getByLabelText('Username') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Al ICE_99!' } })
    expect(input.value).toBe('alice99')
  })
})
