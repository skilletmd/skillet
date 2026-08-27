import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Stories share the `posts` table with hand-written articles, because drafts,
 * the publish gate, the admin editor and the feed builder all already live
 * there. The cost of that reuse is that every blog surface has to SELECT, and
 * for a while none of them did: `getEditorialPosts` existed, with a docstring
 * about a machine-written headline appearing beside two real posts, and exactly
 * one caller used it.
 *
 * Publishing a day's edition would have put eight machine-written cards in the
 * blog index, syndicated them to blog RSS subscribers, served each one at a
 * second URL under /blog/<slug>, and submitted those URLs to search engines.
 *
 * These read the source rather than render, because the failure is a wrong
 * import and that is what to catch.
 */
const WEB = path.join(__dirname, '..')
const read = (p: string) => readFileSync(path.join(WEB, p), 'utf8')

const BLOG_SURFACES = [
  'src/app/(consumer)/blog/page.tsx',
  'src/app/(consumer)/blog/rss.xml/route.ts',
  'src/app/(consumer)/blog/[slug]/page.tsx',
  'src/app/sitemap.ts',
  'src/lib/markdown-representation.ts',
]

describe('stories stay out of the blog', () => {
  it.each(BLOG_SURFACES)('%s selects editorial posts, not every post', (file) => {
    const src = read(file)
    expect(src).not.toMatch(/\bgetAllPosts\b/)
    expect(src).toMatch(/\bgetEditorialPosts\b/)
  })

  it('a blog URL refuses to render a story', () => {
    // Same content on two URLs is a duplicate, and /blog is laid out for an
    // article, not a card with sources and an Import button.
    const src = read('src/app/(consumer)/blog/[slug]/page.tsx')
    expect(src).toMatch(/STORY_TAG/)
    // Exactly one raw getPost, inside the guard itself. Every page call site
    // goes through editorialPost, which is what drops a story.
    expect(src.match(/getPost\(slug\)/g) ?? []).toHaveLength(1)
    expect(src.match(/editorialPost\(slug\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('the sitemap lists a story under /news, not /blog', () => {
    const src = read('src/app/sitemap.ts')
    expect(src).toMatch(/\/news\/\$\{post\.slug\}/)
  })
})
