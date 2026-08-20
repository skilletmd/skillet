import { describe, expect, it } from 'vitest'
import { buildBlogFeed } from '@/lib/blog-feed'
import type { Post } from '@/lib/blog'

function post(overrides: Partial<Post> = {}): Post {
  return {
    slug: 'a-post',
    title: 'A post',
    description: 'A description.',
    author: 'Taylor',
    publishedAt: '2026-08-19T15:00:00Z',
    tags: [],
    status: 'published',
    content: 'Body.',
    ...overrides,
  } as Post
}

const BASE = 'https://skillet.md'

/** Minimal well-formedness check: the DOM parser reports a parsererror node. */
function parses(xml: string): boolean {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return doc.getElementsByTagName('parsererror').length === 0
}

describe('buildBlogFeed (U8)', () => {
  it('emits one item per post, newest first', () => {
    const xml = buildBlogFeed(
      [
        post({ slug: 'newer', title: 'Newer', publishedAt: '2026-08-19T15:00:00Z' }),
        post({ slug: 'older', title: 'Older', publishedAt: '2026-01-01T00:00:00Z' }),
      ],
      BASE,
    )

    expect(xml.match(/<item>/g)).toHaveLength(2)
    expect(xml.indexOf('Newer')).toBeLessThan(xml.indexOf('Older'))
  })

  it('links every item absolutely at the configured base', () => {
    const xml = buildBlogFeed([post({ slug: 'a-post' })], BASE)
    expect(xml).toContain('<link>https://skillet.md/blog/a-post</link>')
  })

  it('stays well-formed when a title or description carries XML metacharacters', () => {
    const xml = buildBlogFeed(
      [
        post({
          title: 'Skills & agents <not a tag>',
          description: `He said "don't" & left`,
        }),
      ],
      BASE,
    )

    expect(parses(xml)).toBe(true)
    expect(xml).toContain('&amp;')
    expect(xml).not.toContain('<not a tag>')
  })

  it('omits pubDate rather than emitting an invalid one', () => {
    const xml = buildBlogFeed([post({ publishedAt: null })], BASE)

    expect(parses(xml)).toBe(true)
    expect(xml).not.toContain('Invalid Date')
    expect(xml).not.toContain('<pubDate>')
  })

  it('is a valid empty channel when there are no posts', () => {
    const xml = buildBlogFeed([], BASE)

    expect(parses(xml)).toBe(true)
    expect(xml).toContain('<channel>')
    expect(xml).not.toContain('<item>')
  })

  it('declares the feed self-link and the channel link', () => {
    const xml = buildBlogFeed([post()], BASE)

    expect(xml).toContain('https://skillet.md/blog/rss.xml')
    expect(xml).toContain('<link>https://skillet.md/blog</link>')
  })
})
