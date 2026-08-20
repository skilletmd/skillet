import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReportDialogForm } from '@/components/skills/report-dialog'

// --- mock the report API client (assert calls + drive states) -------------
const mockSubmit = vi.fn()
vi.mock('@/lib/report', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/report')>()
  return {
    ...actual,
    submitReport: (...args: unknown[]) => mockSubmit(...args),
  }
})

// AppLink pulls in next/navigation; stub it to a plain anchor.
vi.mock('@/components/app-link', () => ({
  AppLink: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

beforeEach(() => {
  mockSubmit.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReportDialogForm', () => {
  it('submits a safety report with the chosen category and reason', async () => {
    mockSubmit.mockResolvedValue(undefined)
    render(<ReportDialogForm author="alice" slug="tool" />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'malware' } })
    fireEvent.change(screen.getByPlaceholderText(/What’s wrong/), {
      target: { value: 'ships a keylogger' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))

    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
    expect(mockSubmit).toHaveBeenCalledWith('alice', 'tool', {
      category: 'malware',
      reason: 'ships a keylogger',
      claimsOwnership: undefined,
    })
    expect(await screen.findByText('Report received')).toBeInTheDocument()
  })

  it('gates the copyright branch on the ownership checkbox', async () => {
    render(<ReportDialogForm author="alice" slug="tool" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'copyright' } })

    const send = screen.getByRole('button', { name: 'Send report' })
    expect(send).toBeDisabled()
    // The DMCA policy link is offered on this branch.
    expect(screen.getByRole('link', { name: /copyright policy/i })).toHaveAttribute(
      'href',
      '/legal/dmca',
    )

    fireEvent.click(screen.getByRole('checkbox'))
    expect(send).toBeEnabled()

    mockSubmit.mockResolvedValue(undefined)
    fireEvent.click(send)
    await waitFor(() => expect(mockSubmit).toHaveBeenCalledTimes(1))
    expect(mockSubmit).toHaveBeenCalledWith(
      'alice',
      'tool',
      expect.objectContaining({ category: 'copyright', claimsOwnership: true }),
    )
  })

  it('requires text for the "other" category', () => {
    render(<ReportDialogForm author="alice" slug="tool" />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'other' } })
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText(/What’s wrong/), {
      target: { value: 'it impersonates a brand' },
    })
    expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled()
  })

  it('surfaces a rate-limit error and stays open', async () => {
    const { ReportError } = await import('@/lib/report')
    mockSubmit.mockRejectedValue(new ReportError('You’re reporting too quickly.', 'rate_limited', 429))
    render(<ReportDialogForm author="alice" slug="tool" />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'spam' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send report' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/too quickly/)
    // Not the success state — the user can retry.
    expect(screen.queryByText('Report received')).not.toBeInTheDocument()
  })
})
