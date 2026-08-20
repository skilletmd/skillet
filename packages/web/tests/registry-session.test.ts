import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import {
  fetchRegistryProfileBasics,
  fetchRegistryWhoami,
  hasConnectedDevice,
  identityFromAuthJs,
  linkRegistryIdentity,
  mintRegistryWebSession,
  refreshRegistryWebSession,
  revokeRegistrySession,
} from '@/lib/registry-session'

// Characterization: pin the exact registry URL each auth/session builder hits, so
// the literal→REGISTRY_API swap is provably byte-identical. registryBaseUrl() is
// read at call-time, so setting REGISTRY_URL + stubbing fetch is sufficient.
describe('registry-session URL characterization', () => {
  const BASE = 'https://reg.example'
  const prevRegistryUrl = process.env.REGISTRY_URL

  function stubFetch(body: unknown = {}) {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => body })
    vi.stubGlobal('fetch', f)
    return f
  }

  beforeEach(() => {
    process.env.REGISTRY_URL = BASE
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.REGISTRY_URL = prevRegistryUrl
  })

  it('linkRegistryIdentity → /api/v1/auth/link', async () => {
    const f = stubFetch({ user_id: 'u1' })
    await linkRegistryIdentity('tok', { provider: 'github', providerSubjectId: '1' })
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/link`)
  })

  it('mintRegistryWebSession → /api/v1/auth/web/session', async () => {
    const f = stubFetch({ session_token: 's' })
    await mintRegistryWebSession({ provider: 'github', providerSubjectId: '1' })
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/web/session`)
  })

  it('refreshRegistryWebSession → /api/v1/auth/web/session/refresh (sends expected_user_id)', async () => {
    const f = stubFetch({ session_token: 's' })
    await refreshRegistryWebSession({ provider: 'github', providerSubjectId: '1', expectedUserId: 'u1' })
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/web/session/refresh`)
    // The account-binding id must ride on the request body.
    const sent = JSON.parse(f.mock.calls[0][1].body as string)
    expect(sent.expected_user_id).toBe('u1')
  })

  it('fetchRegistryWhoami → /api/v1/whoami', async () => {
    const f = stubFetch({ token_class: 'session' })
    await fetchRegistryWhoami('tok')
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/whoami`)
  })

  it('fetchRegistryProfileBasics → /api/v1/authors/:handle (URL-encoded)', async () => {
    const f = stubFetch({ name: 'x' })
    await fetchRegistryProfileBasics('a b')
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/authors/a%20b`)
  })

  it('hasConnectedDevice → /api/v1/devices', async () => {
    const f = stubFetch({ devices: [] })
    await hasConnectedDevice('tok')
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/devices`)
  })

  it('revokeRegistrySession → /api/v1/auth/logout', async () => {
    const f = stubFetch()
    await revokeRegistrySession('tok')
    expect(f.mock.calls[0][0]).toBe(`${BASE}/api/v1/auth/logout`)
  })
})

describe('identityFromAuthJs', () => {
  it('maps GitHub account fields', () => {
    const identity = identityFromAuthJs(
      {
        provider: 'github',
        type: 'oauth',
        providerAccountId: '12345',
        email: 'dev@example.com',
        username: 'octocat',
      },
      { login: 'octocat', two_factor_authentication: true },
    )

    expect(identity).toEqual({
      provider: 'github',
      providerSubjectId: '12345',
      email: 'dev@example.com',
      login: 'octocat',
      twoFactor: true,
      emailVerified: true,
      displayName: null,
      avatarUrl: null,
    })
  })

  it('maps Google account fields without 2FA', () => {
    const identity = identityFromAuthJs(
      {
        provider: 'google',
        type: 'oauth',
        providerAccountId: 'google-sub',
        email: 'user@example.com',
      },
      {
        email: 'user@example.com',
        name: 'Taylor Swift',
        picture: 'https://lh3.googleusercontent.com/a/avatar',
        email_verified: true,
      },
    )

    expect(identity).toEqual({
      provider: 'google',
      providerSubjectId: 'google-sub',
      email: 'user@example.com',
      login: null,
      twoFactor: false,
      emailVerified: true,
      displayName: 'Taylor Swift',
      avatarUrl: 'https://lh3.googleusercontent.com/a/avatar',
    })
  })

  it('maps GitHub name and avatar', () => {
    const identity = identityFromAuthJs(
      {
        provider: 'github',
        type: 'oauth',
        providerAccountId: '12345',
        email: 'dev@example.com',
        username: 'octocat',
      },
      {
        login: 'octocat',
        name: 'The Octocat',
        image: 'https://avatars.githubusercontent.com/u/1',
        two_factor_authentication: true,
      },
    )

    expect(identity).toEqual({
      provider: 'github',
      providerSubjectId: '12345',
      email: 'dev@example.com',
      login: 'octocat',
      twoFactor: true,
      emailVerified: true,
      displayName: 'The Octocat',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
    })
  })
})
