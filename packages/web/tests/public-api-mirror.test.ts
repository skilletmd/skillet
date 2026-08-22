import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  DELETE,
  GET,
  HEAD,
  OPTIONS,
  POST,
} from '@/app/api/v1/[...path]/route'

/**
 * The read-only public API mirror on the canonical origin.
 *
 * Its narrowness is the security property: no cookie, no Authorization, no
 * writes. `Access-Control-Allow-Origin: *` is only safe because of that, so
 * these tests pin it rather than the proxying mechanics.
 */

let lastRequest: Request | null = null
let upstreamStatus = 200
let upstreamHeaders: Record<string, string> = { 'content-type': 'application/json' }
let upstreamBody: string | null = '{"ok":true}'
let upstreamThrows = false

function call(
  handler: (req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response> | Response,
  path: string,
  init: { method?: string; headers?: Record<string, string> } = {},
) {
  const url = new URL(`/api/v1/${path}`, 'https://skillet.md')
  const req = new NextRequest(url, init)
  const segments = path.split('?')[0]!.split('/').filter(Boolean)
  return handler(req, { params: Promise.resolve({ path: segments }) })
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://skillet.md'
  process.env.REGISTRY_URL = 'http://127.0.0.1:3481'
  lastRequest = null
  upstreamStatus = 200
  upstreamHeaders = { 'content-type': 'application/json' }
  upstreamBody = '{"ok":true}'
  upstreamThrows = false
  vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit) => {
    if (upstreamThrows) throw new Error('ECONNREFUSED')
    lastRequest = new Request(String(input), init)
    return new Response(upstreamStatus === 304 ? null : upstreamBody, {
      status: upstreamStatus,
      headers: upstreamHeaders,
    })
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.NEXT_PUBLIC_SITE_URL
  delete process.env.REGISTRY_URL
})

describe('read forwarding', () => {
  it('forwards the path and query to the registry’s versioned base', async () => {
    await call(GET, 'skills?limit=2&category=devops')
    expect(lastRequest!.url).toBe('http://127.0.0.1:3481/api/v1/skills?limit=2&category=devops')
    expect(lastRequest!.method).toBe('GET')
  })

  // The whole safety argument for `Access-Control-Allow-Origin: *` rests on
  // this: a cross-site fetch must never be able to borrow a visitor's session.
  it('forwards no credentials of any kind', async () => {
    await call(GET, 'skills', {
      headers: {
        cookie: '__Host-skillet-session=secret',
        authorization: 'Bearer skillet_s_deadbeef',
        'x-skillet-web-sig': 'sig',
        accept: 'application/json',
      },
    })
    expect(lastRequest!.headers.get('cookie')).toBeNull()
    expect(lastRequest!.headers.get('authorization')).toBeNull()
    expect(lastRequest!.headers.get('x-skillet-web-sig')).toBeNull()
    expect(lastRequest!.headers.get('accept')).toBe('application/json')
  })

  it('passes the upstream status and body straight through', async () => {
    upstreamStatus = 404
    upstreamBody = '{"error":"Author not found","code":"author_not_found"}'
    const res = await call(GET, 'profiles/nobody')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Author not found', code: 'author_not_found' })
  })

  it('forwards conditional-request headers so a re-read can 304', async () => {
    upstreamStatus = 304
    upstreamHeaders = { etag: '"abc"' }
    const res = await call(GET, 'skills/a/b', { headers: { 'if-none-match': '"abc"' } })
    expect(lastRequest!.headers.get('if-none-match')).toBe('"abc"')
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe('"abc"')
  })

  it('answers HEAD without a body', async () => {
    const res = await HEAD(
      new NextRequest(new URL('https://skillet.md/api/v1/stats'), { method: 'HEAD' }),
      { params: Promise.resolve({ path: ['stats'] }) },
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('reports an unreachable registry as JSON, not a stack', async () => {
    upstreamThrows = true
    const res = await call(GET, 'skills')
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.code).toBe('registry_unavailable')
    expect(body.docs).toBe('https://skillet.md/docs/api#errors')
  })
})

describe('CORS and method surface', () => {
  it('is open to any origin and varies on Accept', async () => {
    const res = await call(GET, 'stats')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('vary')).toBe('Accept, Accept-Encoding')
  })

  it('preflights', async () => {
    const res = OPTIONS()
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, HEAD, OPTIONS')
  })

  it('refuses writes with a JSON 405 that names where to send them', async () => {
    for (const handler of [POST, DELETE]) {
      const res = handler()
      expect(res.status).toBe(405)
      const body = await res.json()
      expect(body.code).toBe('read_only_mirror')
      expect(body.message).toMatch(/openapi\.json/)
    }
    expect(lastRequest, 'a refused write must never reach the registry').toBeNull()
  })
})
