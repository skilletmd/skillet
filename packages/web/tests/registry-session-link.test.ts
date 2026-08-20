import { afterEach, describe, expect, it, vi } from 'vitest'
import { linkRegistryIdentity } from '@/lib/registry-session'

describe('linkRegistryIdentity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('posts identity to /auth/link with session + internal header', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        user_id: 'u1',
        handle: 'taylor',
        email: 'taylor@example.com',
        two_factor: false,
        linked_providers: ['email', 'google'],
        github_linked: false,
      }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await linkRegistryIdentity('skillet_s_test', {
      provider: 'google',
      providerSubjectId: 'google-123',
      email: 'taylor@example.com',
      emailVerified: true,
    })

    expect(result.linked_providers).toEqual(['email', 'google'])
    expect(fetchMock).toHaveBeenCalledOnce()
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls[0]?.[0]).toContain('/api/v1/auth/link')
  })

  it('throws identity_already_linked on 409', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 409,
        json: async () => ({ error: 'identity_already_linked' }),
      })),
    )

    await expect(
      linkRegistryIdentity('skillet_s_test', {
        provider: 'github',
        providerSubjectId: '999',
      }),
    ).rejects.toThrow('identity_already_linked')
  })
})
