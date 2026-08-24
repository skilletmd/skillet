import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
const registryFetchOriginOrDefaultMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/registry-origin', () => ({
  registryFetchOriginOrDefault: registryFetchOriginOrDefaultMock,
}))

import { GET } from '@/app/(consumer)/[author]/kit/[slug]/summon/route'

const KIT = {
  owner: 'shadcn',
  slug: 'ui',
  name: 'Ui',
  description: 'Component work.',
  visibility: 'public',
  skills: [
    {
      skill_id: 'shadcn:shadcn',
      description: 'Manages shadcn components and projects.',
      current_hash: 'sha256:aaa',
      pinned_hash: null,
    },
    {
      // Someone else's skill, curated into shadcn's kit.
      skill_id: 'thiago:migrate-radix',
      description: 'Migrates Radix UI to Base UI.',
      current_hash: 'sha256:bbb',
      pinned_hash: 'sha256:pinned',
    },
  ],
}

function params(author: string, slug: string) {
  return { params: Promise.resolve({ author, slug }) }
}

const req = new Request('https://skillet.md/shadcn/kit/ui/summon')

describe('GET /:author/kit/:slug/summon', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    registryFetchOriginOrDefaultMock.mockReset()
    registryFetchOriginOrDefaultMock.mockReturnValue('https://registry.example')
    vi.stubGlobal('fetch', fetchMock)
  })

  it('returns the kit members in the author-summon envelope', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(KIT), { status: 200 }))

    const res = await GET(req, params('shadcn', 'ui'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.kit).toBe('@shadcn/ui')
    expect(body.handle).toBe('shadcn')
    expect(body.skills).toHaveLength(2)
    expect(body.skills[0]).toMatchObject({
      ref: '@shadcn/shadcn',
      slug: 'shadcn',
      latest_hash: 'sha256:aaa',
      via: null,
    })
  })

  it('credits the true author and names the curator in via', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(KIT), { status: 200 }))

    const body = await (await GET(req, params('shadcn', 'ui'))).json()

    expect(body.skills[1].ref).toBe('@thiago/migrate-radix')
    expect(body.skills[1].via).toBe('shadcn')
  })

  it('prefers the pinned hash over the current one', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(KIT), { status: 200 }))

    const body = await (await GET(req, params('shadcn', 'ui'))).json()

    expect(body.skills[1].latest_hash).toBe('sha256:pinned')
  })

  it('does not expose a non-public kit', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ...KIT, visibility: 'private' }), { status: 200 }),
    )

    const res = await GET(req, params('shadcn', 'ui'))

    expect(res.status).toBe(404)
  })

  it('skips members whose skill_id is unparseable rather than emitting a bad ref', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ ...KIT, skills: [{ skill_id: 'nocolon', description: 'x' }] }),
        { status: 200 },
      ),
    )

    const body = await (await GET(req, params('shadcn', 'ui'))).json()

    expect(body.skills).toEqual([])
  })

  it('returns an empty set, not an error, for a public kit with no members', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ...KIT, skills: [] }), { status: 200 }),
    )

    const res = await GET(req, params('shadcn', 'ui'))

    expect(res.status).toBe(200)
    expect((await res.json()).skills).toEqual([])
  })

  it('404s an unknown kit and 503s an unreachable registry', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }))
    expect((await GET(req, params('shadcn', 'nope'))).status).toBe(404)

    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    expect((await GET(req, params('shadcn', 'ui'))).status).toBe(503)
  })
})
