import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MineKitsPayload } from '@/lib/kits'
import { MyKitsProvider, useMyKits } from '@/components/kits/my-kits-context'

const fetchMock = vi.fn()

vi.mock('@/lib/registry-proxy', () => ({
  registryAuthApi: (path: string) => `/api/registry/api/v1/${path}`,
}))

// A minimal consumer that surfaces `membershipsFor(author, slug)` as visible
// text, so the membership-index logic (build + lookup) can be asserted on
// without going through any particular badge/button component.
function MembershipProbe({ author, slug }: { author: string; slug: string }) {
  const { membershipsFor, loading } = useMyKits()
  if (loading) return <div>loading</div>
  const memberships = membershipsFor(author, slug)
  return (
    <div data-testid="memberships">
      {memberships.length === 0 ? 'none' : memberships.map((m) => m.kitId).join(',')}
    </div>
  )
}

function renderProbe(author = 'thiago', slug = 'skillet-sync') {
  return render(
    <MyKitsProvider>
      <MembershipProbe author={author} slug={slug} />
    </MyKitsProvider>,
  )
}

function minePayload(skillId: string | null): MineKitsPayload {
  return {
    owned: [
      {
        id: 'kit-1',
        owner: 'me',
        name: 'curated',
        slug: 'curated',
        description: null,
        visibility: 'private' as const,
        created_at: 1,
        skills:
          skillId == null
            ? []
            : [
                {
                  skill_id: skillId,
                  pinned_hash: null,
                  current_hash: null,
                  added_at: 1,
                },
              ],
      },
    ],
    member: [],
    subscribed: [],
    author_kits: [],
  }
}

function minePayloadWithSkills(skillIds: string[]): MineKitsPayload {
  return {
    owned: [
      {
        id: 'kit-1',
        owner: 'me',
        name: 'curated',
        slug: 'curated',
        description: null,
        visibility: 'private' as const,
        created_at: 1,
        skills: skillIds.map((skill_id) => ({
          skill_id,
          pinned_hash: null,
          current_hash: null,
          added_at: 1,
        })),
      },
    ],
    member: [],
    subscribed: [],
    author_kits: [],
  }
}

describe('MyKitsProvider membership index', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('shows the membership when the index is fed owner:slug and looked up by the same canonical', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => minePayload('thiago:skillet-sync'),
      })
    })

    renderProbe()

    expect(await screen.findByTestId('memberships')).toHaveTextContent('kit-1')
  })

  it('still matches when skill_id arrives as @owner/slug — index and lookup canonicalize, no silent miss', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => minePayload('@thiago/skillet-sync'),
      })
    })

    renderProbe()

    expect(await screen.findByTestId('memberships')).toHaveTextContent('kit-1')
  })

  it('renders no membership when the skill is in none of the viewer kits', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => minePayload(null) })
    })

    renderProbe()

    expect(await screen.findByTestId('memberships')).toHaveTextContent('none')
  })

  it('does not crash the provider on a malformed skill_id — it is skipped, other skills still show', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        // "totally-unparseable" has no `/` or `:` delimiter — parseRef throws.
        // "thiago:skillet-sync" is a valid, well-formed entry alongside it.
        json: async () => minePayloadWithSkills(['totally-unparseable', 'thiago:skillet-sync']),
      })
    })

    render(
      <MyKitsProvider>
        <MembershipProbe author="thiago" slug="skillet-sync" />
      </MyKitsProvider>,
    )

    // Provider renders (no crash/white-screen) and the valid skill's badge
    // still shows — the malformed entry was silently skipped, not thrown.
    expect(await screen.findByTestId('memberships')).toHaveTextContent('kit-1')
  })

  it('returns no membership (not a throw) when the lookup key itself is malformed', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('whoami')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ handle: 'me' }) })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => minePayload('thiago:skillet-sync'),
      })
    })

    // An author with an out-of-class character fails the owner grammar, so
    // `tryToSkillId` returns null for the lookup key — this must resolve to
    // "no membership", not throw and crash the probe.
    renderProbe('thiago!', 'skillet-sync')

    expect(await screen.findByTestId('memberships')).toHaveTextContent('none')
  })
})
