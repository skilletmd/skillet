import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MachinePairCodePanel } from './machine-pair-code-panel'

const mintResponse = {
  code: '99MZGKAU',
  expires_at: Math.floor(Date.now() / 1000) + 300,
  ttl_sec: 300,
}

describe('MachinePairCodePanel', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => mintResponse,
      })) as unknown as typeof fetch,
    )
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn(async () => undefined) },
    })
  })

  it('shows the pair code and copies only the code from the primary control', async () => {
    const onActiveChange = vi.fn()
    render(<MachinePairCodePanel onActiveChange={onActiveChange} path="computer" />)

    fireEvent.click(screen.getByRole('button', { name: 'Generate a pairing code' }))

    await waitFor(() => {
      expect(screen.getByTestId('pair-code-display')).toHaveTextContent('99MZ-GKAU')
      expect(onActiveChange).toHaveBeenCalledWith(true)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('99MZGKAU')
  })

  it('kills the expired code visually and leads with the re-mint button', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ...mintResponse, expires_at: Math.floor(Date.now() / 1000) - 1 }),
      })) as unknown as typeof fetch,
    )
    const onActiveChange = vi.fn()
    render(<MachinePairCodePanel onActiveChange={onActiveChange} path="computer" autoMint />)

    await waitFor(() => {
      expect(screen.getByText('This code expired')).toBeInTheDocument()
    })

    // The dead code is no longer a copy control…
    const codeBox = screen.getByRole('button', { name: 'Code expired' })
    expect(codeBox).toBeDisabled()
    fireEvent.click(codeBox)
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    // …the re-mint is a real button, and the parent stops polling.
    expect(screen.getByRole('button', { name: 'Get a new code' })).toBeInTheDocument()
    expect(onActiveChange).toHaveBeenLastCalledWith(false)

    // One click mints a live replacement and the box copies again.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => mintResponse })) as unknown as typeof fetch,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Get a new code' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
    })
    expect(screen.queryByText('This code expired')).not.toBeInTheDocument()
  })

  it('renders the full connect command on the cloud path', async () => {
    render(<MachinePairCodePanel path="cloud" />)

    fireEvent.click(screen.getByRole('button', { name: 'Generate a pairing code' }))

    await waitFor(() => {
      expect(screen.getByText(/Run this in its terminal/)).toBeInTheDocument()
    })
    expect(screen.getByText(/npx skilletmd connect 99MZGKAU/)).toBeInTheDocument()
  })
})
