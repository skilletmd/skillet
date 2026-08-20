import type { Post } from '@/lib/blog'
import { blogHref } from '@/lib/urls'

/**
 * RSS 2.0 for the blog. A pure string builder rather than a route body so it is
 * unit-testable without a server, matching how the robots.txt policy is kept
 * separable from its handler.
 *
 * Escaping is done here rather than with CDATA so a stray `]]>` in post copy
 * cannot break the document.
 */

const FEED_PATH = '/blog/rss.xml'

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** RFC 822 date, or null when the post carries no usable date. */
function pubDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toUTCString()
}

function item(post: Post, base: string): string {
  const url = new URL(blogHref(post.slug), base).toString()
  const date = pubDate(post.updatedAt ?? post.publishedAt)
  return [
    '    <item>',
    `      <title>${esc(post.title)}</title>`,
    `      <link>${esc(url)}</link>`,
    `      <guid isPermaLink="true">${esc(url)}</guid>`,
    `      <description>${esc(post.description)}</description>`,
    ...(date ? [`      <pubDate>${date}</pubDate>`] : []),
    '    </item>',
  ].join('\n')
}

/**
 * Build the feed document. `posts` is expected newest-first, which is the order
 * `getAllPosts()` already returns; this does not re-sort, so an explicitly
 * ordered list is preserved.
 */
export function buildBlogFeed(posts: Post[], base: string): string {
  const channelLink = new URL(blogHref(), base).toString()
  const selfLink = new URL(FEED_PATH, base).toString()

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>Skillet Blog</title>',
    `    <link>${esc(channelLink)}</link>`,
    '    <description>Field notes on agent skills: writing them, syncing them, and trusting them.</description>',
    '    <language>en</language>',
    `    <atom:link href="${esc(selfLink)}" rel="self" type="application/rss+xml" />`,
    ...posts.map((p) => item(p, base)),
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}
