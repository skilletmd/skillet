import { describe, expect, it, vi } from 'vitest'
import { GET as robotsTxt } from '@/app/robots.txt/route'
import { GET as llmsTxt } from '@/app/llms.txt/route'
import { isLabPath } from '@/lib/lab-gate'

/**
 * `/lab` is internal tooling — the design system, the scanner audit, the OG and
 * avatar previews. It is reachable in production on purpose, but nothing should
 * lead anyone there.
 *
 * It used to try to 404 itself behind a `SHOW_LAB` flag; that guard was inert
 * (a layout's `notFound()` does not stop its children rendering under
 * `cacheComponents`), so production served the whole design system at 200
 * anyway. The posture now is "reachable but unlisted", which means every
 * discovery surface has to keep excluding it. These are the surfaces.
 */

vi.mock('@/lib/registry', () => ({
  getSkillCatalog: async () => ({ skills: [], total: 0, limit: 0, offset: 0 }),
  getKitCatalog: async () => ({ items: [], total: 0, limit: 0, offset: 0 }),
  getAllAuthorUsernames: async () => [],
}))
vi.mock('@/lib/blog', () => ({ getEditorialPosts: () => [], getStories: () => [] }))

describe('/lab is kept out of every discovery surface', () => {
  it('is disallowed in robots.txt', async () => {
    const body = await robotsTxt().text()
    expect(body).toMatch(/^Disallow: \/lab$/m)
  })

  it('is absent from the sitemap', async () => {
    const { default: sitemap } = await import('@/app/sitemap')
    const urls = (await sitemap()).map((entry) => entry.url)
    expect(urls.filter((url) => url.includes('/lab'))).toEqual([])
  })

  it('is absent from llms.txt', async () => {
    expect(await llmsTxt().text()).not.toContain('/lab')
  })
})

describe('isLabPath', () => {
  // The tree has exactly one name. `/labs` is a negative case, not a second
  // route: a prefix match that accepted it would silently create one.
  it('matches /lab and nothing that merely starts the same way', () => {
    for (const path of ['/lab', '/lab/design', '/lab/og/preview']) {
      expect(isLabPath(path), path).toBe(true)
    }
    for (const path of ['/', '/labs', '/labrador', '/docs/lab', '/browse']) {
      expect(isLabPath(path), path).toBe(false)
    }
  })
})
