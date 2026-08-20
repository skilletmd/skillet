import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/mark-dynamic-route', () => ({ markDynamicRoute: vi.fn(async () => {}) }))

import { GET } from '@/app/api/search/docs/route'

function req(url: string) {
  return new Request(`http://localhost${url}`)
}

describe('GET /api/search/docs', () => {
  it('returns matching docs for a query', async () => {
    const res = await GET(req('/api/search/docs?q=publish'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { docs: { type: string; url: string }[] }
    expect(Array.isArray(body.docs)).toBe(true)
    expect(body.docs.length).toBeGreaterThan(0)
    expect(body.docs.every((d) => d.type === 'doc')).toBe(true)
  })

  it('returns an empty list for a missing/empty query', async () => {
    const res = await GET(req('/api/search/docs'))
    expect(res.status).toBe(200)
    expect((await res.json()).docs).toEqual([])
  })

  it('respects the limit param', async () => {
    const res = await GET(req('/api/search/docs?q=skill&limit=1'))
    const body = (await res.json()) as { docs: unknown[] }
    expect(body.docs.length).toBeLessThanOrEqual(1)
  })

  it('degrades to an empty list if the search throws', async () => {
    const search = await import('@/lib/docs-search')
    const spy = vi.spyOn(search, 'searchDocs').mockImplementation(() => {
      throw new Error('boom')
    })
    const res = await GET(req('/api/search/docs?q=publish'))
    expect(res.status).toBe(200)
    expect((await res.json()).docs).toEqual([])
    spy.mockRestore()
  })
})
