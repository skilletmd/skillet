import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MineKitsPayload } from '@/lib/kits'
import { MyKitsProvider, useMyKits } from '@/components/kits/my-kits-context'
import { SkillKitControl } from '@/components/kits/skill-kit-control'

const fetchMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}))

vi.mock('@/lib/registry-proxy', () => ({
  registryAuthApi: (path: string) => `/api/registry/api/v1/${path}`,
}))

// Everyone has an auto "Saved" kit (kind: 'saved') plus named kits. The skill
// under test (thiago:skillet-sync) is in the named "curated" kit; `savedHasSkill`
// controls whether it's also in the viewer's Saved kit.
function minePayload({ savedHasSkill = false, linkedKit = false } = {}): MineKitsPayload {
  const entry = {
    skill_id: 'thiago:skillet-sync',
    pinned_hash: null,
    current_hash: null,
    added_at: 1,
  }
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
      {
        id: 'kit-1',
        owner: 'me',
        name: 'curated',
        slug: 'curated',
        description: null,
        visibility: 'private' as const,
        created_at: 1,
        skills: [entry],
      },
      {
        id: 'kit-2',
        owner: 'me',
        name: 'other',
        slug: 'other',
        description: null,
        visibility: 'private' as const,
        created_at: 2,
        skills: [],
      },
      // A GitHub-synced kit: its skills are managed in the repo, so the dropdown
      // must not let you toggle this skill into/out of it.
      ...(linkedKit
        ? [
            {
              id: 'kit-synced',
              owner: 'me',
              name: 'synced',
              slug: 'synced',
              description: null,
              visibility: 'private' as const,
              created_at: 3,
              source_type: 'linked' as const,
              source: {
                repo: 'everyinc/compound-engineering-plugin',
                ref: null,
                path: null,
                last_synced_sha: null,
              },
              skills: [],
            },
          ]
        : []),
    ],
    member: [],
    subscribed: [],
    author_kits: [],
  }
}

function renderControl(props?: { author?: string; slug?: string }) {
  return render(
    <MyKitsProvider>
      <SkillKitControl
        author={props?.author ?? 'thiago'}
        slug={props?.slug ?? 'skillet-sync'}
        variant="compact"
      />
    </MyKitsProvider>,
  )
}

describe('SkillKitControl', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows a quiet Add (no kit caret) for a skill not in your library', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => minePayload() })
    })

    // fresh-skill is in none of the viewer's kits, so the control offers to add it.
    // The destination caret stays hidden until it's in — a browse grid stays calm.
    renderControl({ slug: 'fresh-skill' })

    expect(await screen.findByRole('button', { name: 'Add to Saved' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to a kit' })).toBeNull()
  })

  it('shows the saved state when the skill is already in your Saved kit', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => minePayload({ savedHasSkill: true }),
      })
    })

    renderControl()
    expect(
      await screen.findByRole('button', { name: 'Added · remove from Saved' }),
    ).toBeTruthy()
  })

  it('one-click Add posts the skill to your Saved kit', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      if (url.includes('/kits/saved-kit/skills') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => minePayload() })
    })

    const user = userEvent.setup()
    // A skill in no kit: the primary button adds it straight to your Saved kit.
    renderControl({ slug: 'fresh-skill' })
    await user.click(await screen.findByRole('button', { name: 'Add to Saved' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/registry/api/v1/kits/saved-kit/skills',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('routes a skill into a named kit via the caret dropdown', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      if (url.includes('/kits/kit-2/skills') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => minePayload() })
    })

    const user = userEvent.setup()
    renderControl()
    await user.click(await screen.findByRole('button', { name: 'Add to a kit' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'other' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/registry/api/v1/kits/kit-2/skills',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('removes a skill from a named kit via the caret dropdown', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      if (init?.method === 'DELETE') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => minePayload() })
    })

    const user = userEvent.setup()
    renderControl()
    await user.click(await screen.findByRole('button', { name: 'Add to a kit' }))
    await user.click(await screen.findByRole('menuitemcheckbox', { name: 'curated' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/registry/api/v1/kits/kit-1/skills/thiago/skillet-sync',
        expect.objectContaining({ method: 'DELETE' }),
      )
    })
  })

  it('hides GitHub-synced kits from the dropdown — not a valid Add destination', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => minePayload({ linkedKit: true }),
      })
    })

    const user = userEvent.setup()
    renderControl()
    await user.click(await screen.findByRole('button', { name: 'Add to a kit' }))

    // Editable kits are still offered; the synced kit is omitted entirely.
    expect(await screen.findByRole('menuitemcheckbox', { name: 'other' })).toBeTruthy()
    expect(screen.queryByRole('menuitemcheckbox', { name: /synced/i })).toBeNull()
  })

  it('refetches kits when the dropdown opens so a newly created kit appears', async () => {
    let withNewKit = false
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      // The kit "fresh" only exists on the SECOND /kits/mine call — i.e. it was
      // created elsewhere after this control first loaded.
      const payload = minePayload()
      if (withNewKit) {
        payload.owned.push({
          id: 'kit-fresh',
          owner: 'me',
          name: 'fresh',
          slug: 'fresh',
          description: null,
          visibility: 'private' as const,
          created_at: 9,
          skills: [],
        })
      }
      withNewKit = true
      return Promise.resolve({ ok: true, status: 200, json: async () => payload })
    })

    const user = userEvent.setup()
    renderControl()
    // Not present on first load.
    await user.click(await screen.findByRole('button', { name: 'Add to a kit' }))
    expect(await screen.findByRole('menuitemcheckbox', { name: 'fresh' })).toBeTruthy()
  })

  it('creates a kit inline and adds the skill to it', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      if (url.endsWith('/kits') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ id: 'kit-new', owner: 'me', name: 'Fresh', skills: [] }),
        })
      }
      if (url.includes('/kits/kit-new/skills') && init?.method === 'POST') {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => minePayload() })
    })

    const user = userEvent.setup()
    renderControl()

    await user.click(await screen.findByRole('button', { name: 'Add to a kit' }))
    await user.click(await screen.findByRole('button', { name: '+ New' }))
    await user.type(await screen.findByRole('textbox', { name: /new kit name/i }), 'Fresh')
    await user.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/registry/api/v1/kits',
        expect.objectContaining({ method: 'POST' }),
      )
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/registry/api/v1/kits/kit-new/skills',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('treats your own skill the same — quiet Add, caret hidden until added', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => minePayload() })
    })

    // Own skills get the same control as everyone else's; my-skill is in no kit,
    // so it's the plain Add with the destination caret hidden until it's in.
    renderControl({ author: 'me', slug: 'my-skill' })

    expect(await screen.findByRole('button', { name: 'Add to Saved' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Add to a kit' })).toBeNull()
  })

  it('does not fetch on mount when initialized with bootstrap data', async () => {
    render(
      <MyKitsProvider initial={{ viewerHandle: 'me', kits: minePayload() }}>
        <SkillKitControl author="thiago" slug="fresh-skill" variant="compact" />
      </MyKitsProvider>,
    )

    expect(await screen.findByRole('button', { name: 'Add to Saved' })).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refresh still refetches after bootstrap', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => minePayload() })
    })

    function RefreshKitState() {
      const { refresh } = useMyKits()
      return (
        <button type="button" onClick={() => void refresh()}>
          Refresh kits
        </button>
      )
    }

    const user = userEvent.setup()
    render(
      <MyKitsProvider initial={{ viewerHandle: 'me', kits: minePayload() }}>
        <RefreshKitState />
      </MyKitsProvider>,
    )

    expect(fetchMock).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Refresh kits' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/registry/api/v1/kits/mine',
        expect.any(Object),
      )
    })
  })
})
