import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.hoisted(() => vi.fn())
const registryFetchOriginOrDefaultMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/registry-origin', () => ({
  registryFetchOriginOrDefault: registryFetchOriginOrDefaultMock,
}))

import { GET } from '@/app/(consumer)/[author]/summon/route'

const CANDIDATES = {
  handle: 'mattpocock',
  skills: [
    {
      ref: '@mattpocock/code-review',
      slug: 'code-review',
      description: 'Reviews a PR the way I would.',
      latest_hash: 'sha256:abc',
      via: null,
    },
    {
      // Curated into mattpocock's kit but authored by someone else: the ref
      // names the true author, which is the whole point of the summon set.
      ref: '@thiago/blog-writer',
      slug: 'blog-writer',
      description: 'Drafts a post from an outline.',
      latest_hash: 'sha256:def',
      via: 'mattpocock',
    },
  ],
}

function params(author: string) {
  return { params: Promise.resolve({ author }) }
}

describe('GET /:author/summon', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    registryFetchOriginOrDefaultMock.mockReset()
    registryFetchOriginOrDefaultMock.mockReturnValue('https://registry.example')
    vi.stubGlobal('fetch', fetchMock)
  })

  it('proxies the registry candidate list, curated entries included', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(CANDIDATES), { status: 200 }),
    )

    const res = await GET(new Request('https://skillet.md/mattpocock/summon'), params('mattpocock'))

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body.handle).toBe('mattpocock')
    expect(body.skills).toHaveLength(2)
    // Curated line keeps the true author in the ref rather than the curator.
    expect(body.skills[1].ref).toBe('@thiago/blog-writer')
    expect(body.skills[1].via).toBe('mattpocock')
  })

  it('calls the registry summon endpoint for the requested handle', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(CANDIDATES), { status: 200 }),
    )

    await GET(new Request('https://skillet.md/mattpocock/summon'), params('mattpocock'))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://registry.example/api/v1/authors/mattpocock/summon',
    )
  })

  it('encodes the handle rather than interpolating it raw', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(CANDIDATES), { status: 200 }))

    await GET(new Request('https://skillet.md/a%2Fb/summon'), params('a/b'))

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      'https://registry.example/api/v1/authors/a%2Fb/summon',
    )
  })

  it('returns 404 for a handle with no public kit, not an empty success', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 404 }))

    const res = await GET(new Request('https://skillet.md/nobody/summon'), params('nobody'))

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found', handle: 'nobody' })
  })

  it('returns 502 when the registry errors', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))

    const res = await GET(new Request('https://skillet.md/mattpocock/summon'), params('mattpocock'))

    expect(res.status).toBe(502)
  })

  it('returns 503 when the registry is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const res = await GET(new Request('https://skillet.md/mattpocock/summon'), params('mattpocock'))

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'registry_unavailable' })
  })
})
