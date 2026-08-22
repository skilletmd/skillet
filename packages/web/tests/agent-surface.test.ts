import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { agentSurfaceResponse, resetAgentSurfaceCaches } from '@/lib/agent-surface'

/**
 * The pre-render decision `proxy.ts` delegates: real 404s, Markdown
 * negotiation, and 406. Every registry lookup is stubbed at `fetch`, so this
 * asserts the decision, not the registry.
 */

const ORIGIN = 'https://skillet.md'

type FetchStub = (url: string) => { status: number; body?: string } | 'network-error'

let handleFetch: FetchStub = () => ({ status: 404 })

function request(
  path: string,
  { accept, headers = {}, method = 'GET', auth = null as unknown }: {
    accept?: string
    headers?: Record<string, string>
    method?: string
    auth?: unknown
  } = {},
) {
  const all: Record<string, string> = { ...headers }
  if (accept !== undefined) all.accept = accept
  const req = new NextRequest(new URL(path, ORIGIN), { method, headers: all })
  return Object.assign(req, { auth }) as NextRequest & { auth?: unknown }
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = 'https://skillet.md'
  // Pin the self-request origin so the /404 fetch is assertable.
  process.env.SKILLET_WEB_SELF_ORIGIN = 'http://127.0.0.1:3480'
  resetAgentSurfaceCaches()
  vi.stubGlobal('fetch', async (input: URL | string) => {
    const url = String(input)
    const result = handleFetch(url)
    if (result === 'network-error') throw new Error('ECONNREFUSED')
    return new Response(result.body ?? '{}', { status: result.status })
  })
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_SITE_URL
  delete process.env.SKILLET_WEB_SELF_ORIGIN
  vi.unstubAllGlobals()
  handleFetch = () => ({ status: 404 })
})

describe('hard 404s', () => {
  it('404s a path that matches no route, without touching the registry', async () => {
    const spy = vi.fn()
    handleFetch = (url) => {
      spy(url)
      return { status: 200 }
    }
    const res = await agentSurfaceResponse(request('/some-path/that/does/not/exist'))
    expect(res?.status).toBe(404)
    expect(spy).not.toHaveBeenCalled()
  })

  it('404s a handle the registry does not know', async () => {
    handleFetch = () => ({ status: 404 })
    const res = await agentSurfaceResponse(request('/some-path-that-does-not-exist'))
    expect(res?.status).toBe(404)
  })

  it('renders a handle the registry does know', async () => {
    handleFetch = () => ({ status: 200 })
    expect(await agentSurfaceResponse(request('/shadcn'))).toBeNull()
  })

  // The whole point of failing open: a registry blip must not turn every
  // profile and skill page on the site into a dead link.
  it('renders normally when the registry cannot answer', async () => {
    handleFetch = () => 'network-error'
    expect(await agentSurfaceResponse(request('/shadcn'))).toBeNull()

    resetAgentSurfaceCaches()
    handleFetch = () => ({ status: 503 })
    expect(await agentSurfaceResponse(request('/shadcn'))).toBeNull()
  })

  // A deprecated skill answers 410 with a tombstone the page renders.
  it('renders a deprecated skill rather than 404ing it', async () => {
    handleFetch = () => ({ status: 410 })
    expect(await agentSurfaceResponse(request('/shadcn/retired'))).toBeNull()
  })

  it('memoizes a lookup so a handle sweep is not one read per probe', async () => {
    let calls = 0
    handleFetch = () => {
      calls += 1
      return { status: 404 }
    }
    await agentSurfaceResponse(request('/nope-one'))
    await agentSurfaceResponse(request('/nope-one'))
    await agentSurfaceResponse(request('/nope-one'))
    expect(calls).toBe(1)
  })

  // A signed-in viewer can own private skills and unlisted kits an anonymous
  // lookup cannot see; 404ing someone's own page would be worse than a soft 404.
  it('never 404s a page for a signed-in viewer', async () => {
    handleFetch = () => ({ status: 404 })
    expect(
      await agentSurfaceResponse(request('/my-handle', { auth: { user: { id: 'u1' } } })),
    ).toBeNull()
  })

  it('serves the 404 body as Markdown to a non-browser client', async () => {
    const res = await agentSurfaceResponse(request('/nope/nope', { accept: '*/*' }))
    expect(res?.status).toBe(404)
    expect(res?.headers.get('content-type')).toContain('text/markdown')
    const body = await res!.text()
    expect(body).toContain('# 404 Not Found')
    expect(body).toContain('/llms.txt')
    expect(body).toContain('/openapi.json')
    // Canonical site URLs, not the request's host: an agent may have reached a
    // worker through some other name and still needs URLs it can reuse.
    expect(body).toContain('https://skillet.md/llms.txt')
  })

  // Next reserves `/404` as its own not-found route and answers it with a 404
  // status, so the self-request must accept that as a successful render.
  it('serves the branded HTML page to a browser, under a 404 status', async () => {
    handleFetch = (url) =>
      url.endsWith('/404') ? { status: 404, body: '<html><body>branded</body></html>' } : { status: 404 }
    const res = await agentSurfaceResponse(
      request('/nope/nope', { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' }),
    )
    expect(res?.status).toBe(404)
    expect(res?.headers.get('content-type')).toContain('text/html')
    expect(await res!.text()).toContain('branded')
  })

  it('falls back to a standalone document when /404 cannot be rendered', async () => {
    handleFetch = () => 'network-error'
    // A structurally-unknown path, so the 404 verdict does not depend on the
    // registry the stub just made unreachable.
    const res = await agentSurfaceResponse(request('/a/b/c/d/e', { accept: 'text/html' }))
    expect(res?.status).toBe(404)
    expect(await res!.text()).toContain('<!doctype html>')
  })

  it('marks every 404 noindex and uncacheable', async () => {
    const res = await agentSurfaceResponse(request('/nope/nope', { accept: '*/*' }))
    expect(res?.headers.get('x-robots-tag')).toBe('noindex')
    expect(res?.headers.get('cache-control')).toBe('no-store')
    expect(res?.headers.get('vary')).toContain('Accept')
  })
})

describe('markdown negotiation', () => {
  it('rewrites a Markdown request to the Markdown route', async () => {
    handleFetch = () => ({ status: 200 })
    const res = await agentSurfaceResponse(request('/docs/install', { accept: 'text/markdown' }))
    expect(res?.headers.get('x-middleware-rewrite')).toContain('/api/md/docs/install')
    expect(res?.headers.get('vary')).toContain('Accept')
  })

  it('rewrites the homepage to the bare Markdown route', async () => {
    const res = await agentSurfaceResponse(request('/', { accept: 'text/markdown' }))
    expect(res?.headers.get('x-middleware-rewrite')).toMatch(/\/api\/md$/)
  })

  it('leaves HTML requests alone', async () => {
    expect(
      await agentSurfaceResponse(request('/docs/install', { accept: 'text/html' })),
    ).toBeNull()
  })

  // A crawler following a `rel="alternate"` link may send no Accept at all.
  it('serves an explicit .md URL regardless of Accept', async () => {
    const res = await agentSurfaceResponse(request('/docs/install.md'))
    expect(res?.headers.get('x-middleware-rewrite')).toContain('/api/md/docs/install')
  })

  it('does not treat a published SKILL.md artifact as a negotiable page', async () => {
    const res = await agentSurfaceResponse(request('/.well-known/agent-skills/write-a-skill/SKILL.md'))
    expect(res).toBeNull()
  })

  it('404s a Markdown request for a resource that does not exist', async () => {
    handleFetch = () => ({ status: 404 })
    const res = await agentSurfaceResponse(request('/nobody-here', { accept: 'text/markdown' }))
    expect(res?.status).toBe(404)
    expect(res?.headers.get('content-type')).toContain('text/markdown')
  })

  it('406s a client that accepts neither representation', async () => {
    const res = await agentSurfaceResponse(request('/docs/install', { accept: 'application/pdf' }))
    expect(res?.status).toBe(406)
    expect(res?.headers.get('vary')).toContain('Accept')
  })
})

describe('Next transport is left alone', () => {
  // `Accept: text/x-component` satisfies no representation here. Negotiating it
  // would 406 every client-side navigation in the app.
  it('ignores RSC payload requests', async () => {
    expect(
      await agentSurfaceResponse(
        request('/nope/nope', { accept: 'text/x-component', headers: { rsc: '1' } }),
      ),
    ).toBeNull()
  })

  it('ignores prefetches and Server Actions', async () => {
    expect(
      await agentSurfaceResponse(
        request('/nope/nope', { headers: { 'next-router-prefetch': '1' } }),
      ),
    ).toBeNull()
    expect(
      await agentSurfaceResponse(
        request('/nope/nope', { method: 'POST', headers: { 'next-action': 'abc' } }),
      ),
    ).toBeNull()
  })

  it('ignores non-GET requests', async () => {
    expect(await agentSurfaceResponse(request('/nope/nope', { method: 'POST' }))).toBeNull()
  })
})

describe('self-request origin for the branded 404', () => {
  // The public origin would hairpin out through the CDN and back; the worker's
  // own loopback port is one hop.
  it('prefers an explicit override, then the worker port, then the request', async () => {
    const seen: string[] = []
    handleFetch = (url) => {
      seen.push(url)
      return url.includes('/404') ? { status: 404, body: '<html>b</html>' } : { status: 404 }
    }

    await agentSurfaceResponse(request('/a/b/c/d', { accept: 'text/html' }))
    expect(seen.at(-1)).toBe('http://127.0.0.1:3480/404')

    delete process.env.SKILLET_WEB_SELF_ORIGIN
    process.env.PORT = '3482'
    resetAgentSurfaceCaches()
    await agentSurfaceResponse(request('/a/b/c/d', { accept: 'text/html' }))
    expect(seen.at(-1)).toBe('http://127.0.0.1:3482/404')

    delete process.env.PORT
    resetAgentSurfaceCaches()
    await agentSurfaceResponse(request('/a/b/c/d', { accept: 'text/html' }))
    expect(seen.at(-1)).toBe('https://skillet.md/404')
  })
})
