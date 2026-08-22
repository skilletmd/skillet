import { describe, expect, it } from 'vitest'
import { siteRedirects } from '@/lib/redirects'

/**
 * www.skillet.md served the whole site at 200 alongside the apex, with no
 * canonical to disambiguate them, so every URL existed twice. The redirect
 * lives here rather than at the edge for the same reason robots.txt does: the
 * policy diffs like everything else.
 *
 * Note this rule is sitewide, not blog-only — it catches /, /browse, every
 * skill and profile page, and the API surface.
 */
async function redirects() {
  return siteRedirects()
}

const isHostRule = (r: { has?: unknown }) =>
  Array.isArray(r.has) &&
  r.has.some((h: { type?: string }) => h && typeof h === 'object' && h.type === 'host')

describe('host canonicalization (U5)', () => {
  it('permanently redirects the www host', async () => {
    const rule = (await redirects()).find(isHostRule)

    expect(rule).toBeDefined()
    expect(rule?.permanent).toBe(true)
    expect(rule?.has).toContainEqual({ type: 'host', value: 'www.skillet.md' })
  })

  it('sends the www host to the apex origin and preserves the path', async () => {
    const rule = (await redirects()).find(isHostRule)

    expect(rule?.source).toBe('/:path*')
    expect(rule?.destination).toBe('https://skillet.md/:path*')
  })

  it('canonicalizes the host before any path-level redirect runs', async () => {
    const all = await redirects()
    const hostIndex = all.findIndex(isHostRule)

    expect(hostIndex).toBe(0)
  })

  it('leaves the existing path redirects intact', async () => {
    const paths = (await redirects()).filter((r) => !isHostRule(r))

    expect(paths.map((r) => r.source)).toEqual([
      '/status',
      '/new',
      '/docs/get-started/what-is-skillet',
      '/safety',
      '/api',
      '/privacy',
      '/settings/connectors',
      '/feed/updates',
      '/feed/notifications',
    ])
  })
})

describe('redirect targets exist', () => {
  // A redirect to a route that was never built is worse than a 404: it costs a
  // round trip and still dead-ends. Two of these pointed at `/internal/*`, a
  // prefix with no routes at all, and the miss was invisible while every
  // unknown path answered 200 with the app shell.
  it('points every path redirect at a real route', async () => {
    const { readdirSync, existsSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const appDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'app')

    /**
     * Does a CONCRETE route serve this pathname? Route groups `(name)` are
     * transparent, dynamic segments deliberately are not: `/internal/design`
     * "matches" `/[author]/[skill]` and would pass a permissive check while
     * 404ing at runtime, which is exactly the bug this guards.
     */
    const staticRouteExists = (pathname: string): boolean => {
      const segments = pathname.split('/').filter(Boolean)
      const walk = (dir: string, rest: string[]): boolean => {
        if (rest.length === 0) {
          return ['page.tsx', 'route.ts', 'route.tsx'].some((f) => existsSync(join(dir, f)))
        }
        const [head, ...tail] = rest
        const entries = readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())
        for (const entry of entries) {
          if (entry.name === head && walk(join(dir, entry.name), tail)) return true
          if (entry.name.startsWith('(') && walk(join(dir, entry.name), rest)) return true
        }
        return false
      }
      return walk(appDir, segments)
    }

    // Docs pages are served by a catch-all over `content/docs`, so a concrete
    // route file never exists for them. Ask the same loader the route uses.
    const { getDoc } = await import('./docs')
    const docServes = (pathname: string): boolean => {
      if (pathname !== '/docs' && !pathname.startsWith('/docs/')) return false
      return getDoc(pathname.replace(/^\/docs\/?/, '').split('/').filter(Boolean)) !== null
    }

    const paths = (await redirects()).filter((r) => !isHostRule(r))
    const dangling = paths
      .map((r) => r.destination)
      .map((dest) => dest.split('?')[0]!)
      .filter((dest) => dest.startsWith('/') && !staticRouteExists(dest) && !docServes(dest))
    expect(dangling, `these redirects lead nowhere:\n${dangling.join('\n')}`).toEqual([])
  })
})
