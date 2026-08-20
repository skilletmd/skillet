import { describe, it, expect, vi, beforeEach } from 'vitest'

const authMock = vi.hoisted(() => vi.fn())

vi.mock('@/auth', () => ({
  auth: authMock,
}))

describe('getSession', () => {
  beforeEach(() => {
    authMock.mockReset()
  })

  it('returns the auth session from auth()', async () => {
    const session = { handle: 'taylor' }
    authMock.mockResolvedValue(session)

    vi.resetModules()
    const { getSession } = await import('@/lib/get-session')

    await expect(getSession()).resolves.toEqual(session)
    expect(authMock).toHaveBeenCalled()
  })
})
