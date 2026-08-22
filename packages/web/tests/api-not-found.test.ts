import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GET } from '@/app/api/[...unmatched]/route'

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

describe('/api catch-all', () => {
  it('answers an unrouted API path with a structured JSON 404', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://skillet.md'
    const res = GET()
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
    const body = await res.json()
    expect(body.code).toBe('route_not_found')
    expect(body.statusCode).toBe(404)
    expect(body.docs).toBe('https://skillet.md/docs/api#errors')
    // The point of the body: tell the agent where the real surface is.
    expect(body.message).toMatch(/openapi\.json/)
    expect(body.message).toMatch(/llms\.txt/)
    delete process.env.NEXT_PUBLIC_SITE_URL
  })

  // The catch-all is the least specific route under /api. Next resolves static
  // segments and deeper dynamic routes first, so nothing real is shadowed — but
  // a regression here would silently 404 sign-in, which is why this is pinned.
  // Read from the source tree, not the build output, so it runs in a fresh
  // checkout with no `.next/`.
  it('is the only catch-all directly under /api', () => {
    const apiDir = join(WEB_ROOT, 'src', 'app', 'api')
    const catchAlls = readdirSync(apiDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^\[\.\.\..+\]$/.test(e.name))
      .map((e) => e.name)
    expect(catchAlls).toEqual(['[...unmatched]'])
    // A second catch-all at this depth would make resolution order ambiguous.
    for (const route of ['auth', 'registry', 'hc', 'v1', 'md']) {
      expect(existsSync(join(apiDir, route)), route).toBe(true)
    }
  })
})

describe('/api itself', () => {
  // `/api` is the namespace, not a page, so it had no route and answered the
  // app shell. It redirects to the reference rather than growing a second page
  // that would drift from it — and the redirect must match ONLY the bare path,
  // or every route handler on the site would bounce to the docs.
  it('redirects the bare path to the reference and nothing else', async () => {
    const { siteRedirects } = await import('@/lib/redirects')
    const rule = siteRedirects().find((r) => r.source === '/api')
    expect(rule).toBeDefined()
    expect(rule!.destination).toBe('/docs/api')
    expect(rule!.source).not.toContain(':')
    expect(rule!.source).not.toContain('*')
    // No other rule may swallow the API namespace.
    const overreaching = siteRedirects().filter(
      (r) => r.source.startsWith('/api/') || r.source === '/api/:path*',
    )
    expect(overreaching).toEqual([])
  })
})
