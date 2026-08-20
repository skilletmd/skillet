import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginCodeForm } from '@/components/login-code-form'

afterEach(() => vi.unstubAllGlobals())

function jsonRes(ok: boolean, body: unknown, status = ok ? 200 : 400) {
  return { ok, status, json: async () => body }
}

describe('LoginCodeForm', () => {
  it('requests a code, then advances to the code-entry step', async () => {
    window.history.replaceState(null, '', '/login')
    const fetchMock = vi.fn().mockResolvedValue(jsonRes(true, { message: 'sent', dev_code: '123456' }))
    vi.stubGlobal('fetch', fetchMock)

    render(<LoginCodeForm />)
    await userEvent.type(screen.getByLabelText('Email address'), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }))

    // Moved to the code step, naming the address.
    expect(screen.getByText(/user@example\.com/)).toBeInTheDocument()
    expect(screen.getByLabelText('Sign-in code')).toBeInTheDocument()
    // Send hit the code endpoint with the email.
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/auth/login-code/send')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ email: 'user@example.com' })
  })

  it('verifies the code and forwards ?callbackUrl', async () => {
    window.history.replaceState(null, '', `/login?callbackUrl=${encodeURIComponent('/feed/global')}`)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(true, { message: 'sent', dev_code: '123456' }))
      .mockResolvedValueOnce(jsonRes(true, { ok: true, redirectTo: '/feed/global' }))
    vi.stubGlobal('fetch', fetchMock)

    render(<LoginCodeForm />)
    await userEvent.type(screen.getByLabelText('Email address'), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }))
    await userEvent.type(screen.getByLabelText('Sign-in code'), '123456')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    // The verify request carries the email, code, and forwarded callbackUrl.
    // (The success navigation itself is exercised by the manual sign-in drive.)
    const [url, init] = fetchMock.mock.calls[1]!
    expect(url).toBe('/api/auth/login-code/verify')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      email: 'user@example.com',
      code: '123456',
      callbackUrl: '/feed/global',
    })
  })

  it('shows an inline error on a wrong/expired code without leaving the step', async () => {
    window.history.replaceState(null, '', '/login')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(true, { message: 'sent', dev_code: '123456' }))
      .mockResolvedValueOnce(jsonRes(false, { ok: false, error: 'invalid_or_expired_code' }))
    vi.stubGlobal('fetch', fetchMock)

    render(<LoginCodeForm />)
    await userEvent.type(screen.getByLabelText('Email address'), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }))
    await userEvent.type(screen.getByLabelText('Sign-in code'), '000000')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(screen.getByText(/didn.t match or has expired/i)).toBeInTheDocument()
    // Still on the code step.
    expect(screen.getByLabelText('Sign-in code')).toBeInTheDocument()
  })

  it('surfaces the lockout message on too_many_attempts', async () => {
    window.history.replaceState(null, '', '/login')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonRes(true, { message: 'sent', dev_code: '123456' }))
      .mockResolvedValueOnce(jsonRes(false, { ok: false, error: 'too_many_attempts' }))
    vi.stubGlobal('fetch', fetchMock)

    render(<LoginCodeForm />)
    await userEvent.type(screen.getByLabelText('Email address'), 'user@example.com')
    await userEvent.click(screen.getByRole('button', { name: /email me a code/i }))
    await userEvent.type(screen.getByLabelText('Sign-in code'), '000000')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(screen.getByText(/too many wrong codes/i)).toBeInTheDocument()
  })
})
