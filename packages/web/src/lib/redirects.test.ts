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
      '/design-system',
      '/og-preview',
      '/index2',
      '/status',
      '/new',
      '/docs/get-started/what-is-skillet',
      '/safety',
      '/settings/connectors',
      '/feed/updates',
      '/feed/notifications',
    ])
  })
})
