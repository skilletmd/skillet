import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MineKitsPayload } from '@/lib/kits'
import { MyKitsProvider } from '@/components/kits/my-kits-context'
import { SkillKitControl } from '@/components/kits/skill-kit-control'
import { SubscribeKitButton } from '@/components/kits/subscribe-kit-button'
import { AddIntentHandler } from '@/components/add-intent-handler'
import { encodeAddIntent, parseAddIntent } from '@/lib/add-intent'

const fetchMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}))

vi.mock('@/lib/registry-proxy', () => ({
  registryAuthApi: (path: string) => `/api/registry/api/v1/${path}`,
}))

// A logged-IN payload with the viewer's auto "Saved" (library) kit.
function minePayload({ savedHasSkill = false } = {}): MineKitsPayload {
  const entry = { skill_id: 'thiago:skillet-sync', pinned_hash: null, current_hash: null, added_at: 1 }
  return {
    owned: [
      {
        id: 'saved-kit',
        owner: 'me',
        name: 'Saved',
        slug: 'saved',
        description: null,
        visibility: 'private' as const,
        kind: 'saved' as const,
        created_at: 0,
        skills: savedHasSkill ? [entry] : [],
      },
    ],
    member: [],
    subscribed: [],
    author_kits: [],
  }
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// --- Param shape ------------------------------------------------------------

describe('add intent token', () => {
  it('round-trips a skill intent', () => {
    expect(parseAddIntent(encodeAddIntent({ type: 'skill', author: 'thiago', slug: 'skillet-sync' }))).toEqual({
      type: 'skill',
      author: 'thiago',
      slug: 'skillet-sync',
    })
  })

  it('round-trips a kit intent', () => {
    expect(parseAddIntent(encodeAddIntent({ type: 'kit', kitId: 'kit-42' }))).toEqual({
      type: 'kit',
      kitId: 'kit-42',
    })
  })

  it('rejects malformed tokens', () => {
    expect(parseAddIntent(null)).toBeNull()
    expect(parseAddIntent('skill:only-author')).toBeNull()
    expect(parseAddIntent('bogus:x')).toBeNull()
  })
})

// --- Logged-out cards render an Add that carries the intent ------------------

describe('logged-out Add cards', () => {
  // No auth: whoami/mine answer 401, so MyKitsProvider resolves to logged-out.
  function loggedOut() {
    fetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 401, json: async () => ({}) }),
    )
  }

  it('skill card renders an Add link carrying a skill intent', async () => {
    loggedOut()
    render(
      <MyKitsProvider>
        <SkillKitControl author="thiago" slug="skillet-sync" variant="compact" />
      </MyKitsProvider>,
    )

    const link = await screen.findByRole('link', { name: 'Add' })
    const href = decodeURIComponent(link.getAttribute('href') ?? '')
    expect(href).toContain('/login?callbackUrl=')
    expect(href).toContain('add=skill:thiago/skillet-sync')
  })

  it('kit card renders an Add link carrying a kit intent', () => {
    render(<SubscribeKitButton kitId="kit-42" initialSubscribed={false} viewerHandle={null} owner="acme" />)

    const link = screen.getByRole('link', { name: 'Add' })
    const href = decodeURIComponent(link.getAttribute('href') ?? '')
    expect(href).toContain('/login?callbackUrl=')
    expect(href).toContain('add=kit:kit-42')
  })
})

// --- Post-login handler replays the add and strips the token ----------------

describe('AddIntentHandler', () => {
  it('adds the skill to the library for ?add=skill: and strips the param', async () => {
    window.history.replaceState({}, '', '/?add=skill:thiago/skillet-sync')
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      if (url.includes('/kits/saved-kit/skills') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => minePayload() })
    })

    render(
      <MyKitsProvider initial={{ viewerHandle: 'me', kits: minePayload() }}>
        <AddIntentHandler />
      </MyKitsProvider>,
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/registry/api/v1/kits/saved-kit/skills',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    await waitFor(() => {
      expect(window.location.search).toBe('')
    })
  })

  it('subscribes the viewer to the kit for ?add=kit: and strips the param', async () => {
    window.history.replaceState({}, '', '/?add=kit:kit-42')
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      if (url.includes('/kits/kit-42/subscribe') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => minePayload() })
    })

    render(
      <MyKitsProvider initial={{ viewerHandle: 'me', kits: minePayload() }}>
        <AddIntentHandler />
      </MyKitsProvider>,
    )

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/registry/api/v1/kits/kit-42/subscribe',
        expect.objectContaining({ method: 'POST' }),
      )
    })
    await waitFor(() => {
      expect(window.location.search).toBe('')
    })
  })

  it('is idempotent — already-saved skill is not re-posted', async () => {
    window.history.replaceState({}, '', '/?add=skill:thiago/skillet-sync')
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => minePayload({ savedHasSkill: true }) })
    })

    render(
      <MyKitsProvider initial={{ viewerHandle: 'me', kits: minePayload({ savedHasSkill: true }) }}>
        <AddIntentHandler />
      </MyKitsProvider>,
    )

    await waitFor(() => {
      expect(window.location.search).toBe('')
    })
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) => String(url).includes('/skills') && (init as RequestInit)?.method === 'POST',
      ),
    ).toBe(false)
  })
})
