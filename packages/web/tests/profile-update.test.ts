// Display-name update lib. fetch is stubbed to cover validation and
// the owner-only error mapping (401/403/404).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MAX_DISPLAY_NAME,
  updateProfile,
  updateDisplayName,
  updateShownAgents,
  uploadAvatar,
  validateDisplayName,
  validateProfileUpdate,
} from '@/lib/profile-update'

const AVATAR_URL = 'https://pub-x.r2.dev/dev/abc123'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

function res(status: number, body: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

describe('validateDisplayName', () => {
  it('rejects empty and over-long names', () => {
    expect(validateDisplayName('   ')).toMatch(/empty/i)
    expect(validateDisplayName('a'.repeat(MAX_DISPLAY_NAME + 1))).toMatch(/at most/i)
  })
  it('accepts a normal name', () => {
    expect(validateDisplayName('Ada Lovelace')).toBeNull()
  })
})

describe('validateProfileUpdate', () => {
  it('accepts profile fields and normalizes bare URLs at save time', () => {
    expect(
      validateProfileUpdate({
        name: 'Ada Lovelace',
        bio: 'First programmer.',
        profileUrl: 'ada.example',
        avatarUrl: AVATAR_URL,
      }),
    ).toBeNull()
  })

  it('rejects invalid profile URLs', () => {
    expect(validateProfileUpdate({ name: 'Ada', profileUrl: 'not a url' })).toMatch(/valid URL/i)
  })
})

describe('updateDisplayName', () => {
  it('PATCHes the proxied profile path with the trimmed name', async () => {
    fetchMock.mockResolvedValue(res(200, { name: 'Ada' }))
    await updateDisplayName('ada', '  Ada  ')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/registry/api/v1/profiles/ada')
    expect(init.method).toBe('PATCH')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body)).toEqual({ name: 'Ada' })
  })

  it('does not call the registry for an invalid name', async () => {
    await expect(updateDisplayName('ada', '')).rejects.toThrow(/empty/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps owner-only errors to friendly messages', async () => {
    fetchMock.mockResolvedValue(res(403, { error: 'forbidden' }))
    await expect(updateDisplayName('bob', 'Ada')).rejects.toThrow(/your own profile/i)

    fetchMock.mockResolvedValue(res(401, { error: 'auth_required' }))
    await expect(updateDisplayName('ada', 'Ada')).rejects.toThrow(/sign in again/i)

    fetchMock.mockResolvedValue(res(404, { error: 'Author not found' }))
    await expect(updateDisplayName('ada', 'Ada')).rejects.toThrow(/not found/i)
  })
})

describe('updateProfile', () => {
  it('PATCHes bio, URL, and avatar fields', async () => {
    fetchMock.mockResolvedValue(res(200, {}))
    await updateProfile('ada', {
      name: 'Ada',
      bio: 'First programmer.',
      profileUrl: 'ada.example',
      avatarUrl: AVATAR_URL,
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body)).toEqual({
      name: 'Ada',
      bio: 'First programmer.',
      profile_url: 'https://ada.example',
      x_handle: null,
      avatar_url: AVATAR_URL,
    })
  })

  it('forwards a self-typed X handle (registry normalizes it)', async () => {
    fetchMock.mockResolvedValue(res(200, {}))
    await updateProfile('ada', { name: 'Ada', xHandle: '@AdaL' })
    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init.body).x_handle).toBe('@AdaL')
  })
})

describe('updateShownAgents', () => {
  it('PATCHes the curated agent list', async () => {
    fetchMock.mockResolvedValue(res(200, {}))
    await updateShownAgents('ada', ['cursor', 'claude-code'])
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/registry/api/v1/profiles/ada')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ shown_agents: ['cursor', 'claude-code'] })
  })

  it('sends [] to show nothing and null to reset to uncurated', async () => {
    fetchMock.mockResolvedValue(res(200, {}))
    await updateShownAgents('ada', [])
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ shown_agents: [] })

    fetchMock.mockResolvedValue(res(200, {}))
    await updateShownAgents('ada', null)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ shown_agents: null })
  })
})

describe('uploadAvatar', () => {
  it('POSTs the raw file to the BFF and returns the stored URL', async () => {
    fetchMock.mockResolvedValue(res(200, { avatarUrl: AVATAR_URL }))
    const file = new File(['bytes'], 'me.png', { type: 'image/png' })

    const url = await uploadAvatar('ada', file)

    expect(url).toBe(AVATAR_URL)
    const [reqUrl, init] = fetchMock.mock.calls[0]
    expect(reqUrl).toBe('/api/profile/avatar?author=ada')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.body).toBe(file)
  })

  it('maps a 413 to the server message', async () => {
    fetchMock.mockResolvedValue(res(413, { error: 'Image is too large (max 12MB).' }))
    await expect(
      uploadAvatar('ada', new File(['x'], 'big.png', { type: 'image/png' })),
    ).rejects.toThrow(/too large/i)
  })

  it('maps a 403 to an owner-only message', async () => {
    fetchMock.mockResolvedValue(res(403, { error: 'forbidden' }))
    await expect(
      uploadAvatar('bob', new File(['x'], 'a.png', { type: 'image/png' })),
    ).rejects.toThrow(/your own profile/i)
  })
})
