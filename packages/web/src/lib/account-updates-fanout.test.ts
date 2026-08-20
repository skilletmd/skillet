import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  approveItems,
  rejectItems,
  muteTeamKit,
  unmuteTeamKit,
  type DecidableItem,
} from '@/lib/account-updates'

// The fan-out helpers back a kit group's single "Update all" / "Skip": they call
// the per-skill approve/reject endpoint once per item and report which skill ids
// the server accepted, so the caller reconciles its queue against `ok` only.
const items: DecidableItem[] = [
  { skill_id: 'a:one', to_hash: 'h1' },
  { skill_id: 'a:two', to_hash: 'h2' },
  { skill_id: 'a:three', to_hash: 'h3' },
]

afterEach(() => vi.unstubAllGlobals())

describe('approveItems / rejectItems fan-out', () => {
  it('approves every item and returns all ids in ok', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await approveItems(items)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(res.ok.sort()).toEqual(['a:one', 'a:three', 'a:two'])
    expect(res.failed).toEqual([])
  })

  it('reports a partial failure without throwing', async () => {
    // Second call fails; the other two succeed. The helper must not reject.
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n += 1
        return new Response(null, { status: n === 2 ? 500 : 200 })
      }),
    )

    const res = await rejectItems(items)

    expect(res.ok).toEqual(['a:one', 'a:three'])
    expect(res.failed).toEqual(['a:two'])
  })

  it('makes no requests for an empty set', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await approveItems([])

    expect(fetchMock).not.toHaveBeenCalled()
    expect(res).toEqual({ ok: [], failed: [] })
  })
})

describe('muteTeamKit / unmuteTeamKit', () => {
  // These are bodyless writes: they must NOT set content-type: application/json,
  // or Fastify's JSON parser 400s on the empty body before the handler runs.
  it('mutes with PUT and no content-type header', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await muteTeamKit('kit_1')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('/me/team-kits/kit_1/mute')
    expect(init.method).toBe('PUT')
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined()
  })

  it('unmutes with DELETE and no content-type header', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await unmuteTeamKit('kit_1')
    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('DELETE')
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined()
  })

  it('throws when the server rejects the mute', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 400 })),
    )
    await expect(muteTeamKit('kit_1')).rejects.toThrow(/mute/i)
  })
})
