import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchDelegations, type Delegation } from '@/lib/enroll-device'

const DK = 'ab'.repeat(32)

function delegation(overrides: Partial<Delegation> = {}): Delegation {
  return {
    device_key_id: DK,
    label: 'Laptop',
    scopes: ['propose', 'approve'],
    issued_at: 1,
    expires_at: 9_999_999_999,
    revoked_at: null,
    status: 'active',
    ...overrides,
  }
}

function okResp(delegations: Delegation[]): Response {
  return { ok: true, json: async () => ({ delegations }) } as unknown as Response
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('fetchDelegations', () => {
  it('returns the delegations array', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResp([delegation()])))
    const rows = await fetchDelegations()
    expect(rows).toHaveLength(1)
    expect(rows[0].device_key_id).toBe(DK)
  })

  it('throws on a non-OK response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response))
    await expect(fetchDelegations()).rejects.toThrow(/401/)
  })
})
