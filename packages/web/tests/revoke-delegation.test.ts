import { beforeEach, describe, expect, it, vi } from 'vitest'
import { revokeDelegationSession } from '@/lib/revoke-delegation'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('revokeDelegationSession', () => {
  it('posts to revoke-session and resolves on ok', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) } as Response)
    await revokeDelegationSession('a'.repeat(64))
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/delegations/'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws with registry message on failure', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'delegation_not_found' }),
    } as Response)
    await expect(revokeDelegationSession('b'.repeat(64))).rejects.toThrow('delegation_not_found')
  })
})
