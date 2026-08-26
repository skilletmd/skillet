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

/** Feed identity: which channel this is and where its items live. Stories share
 *  the builder with the blog but publish at /news/<slug>, so the path is a
 *  parameter rather than a hardcoded blogHref. */
export interface FeedChannel {
  title: string
  description: string
  /** Channel home, e.g. `/news`. */
  home: string
  /** The feed's own URL, e.g. `/news/rss.xml`. */
  self: string
  /** Item permalink builder. */
  itemHref: (slug: string) => string
}

const BLOG_CHANNEL: FeedChannel = {
  title: 'Skillet Blog',
  description: 'Field notes on agent skills: writing them, syncing them, and trusting them.',
  home: blogHref(),
  self: FEED_PATH,
  itemHref: (slug) => blogHref(slug),
}

export const NEWS_CHANNEL: FeedChannel = {
  title: 'Skillet Daily',
  description:
    'What moved in agent skills, and what changed in the registry. Coverage of every runtime, not just ours.',
  home: '/news',
  self: '/news/rss.xml',
  itemHref: (slug) => `/news/${slug}`,
}

function item(post: Post, base: string, channel: FeedChannel = BLOG_CHANNEL): string {
  const url = new URL(channel.itemHref(post.slug), base).toString()
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
export function buildBlogFeed(
  posts: Post[],
  base: string,
  channel: FeedChannel = BLOG_CHANNEL,
): string {
  const channelLink = new URL(channel.home, base).toString()
  const selfLink = new URL(channel.self, base).toString()

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    `    <title>${esc(channel.title)}</title>`,
    `    <link>${esc(channelLink)}</link>`,
    `    <description>${esc(channel.description)}</description>`,
    '    <language>en</language>',
    `    <atom:link href="${esc(selfLink)}" rel="self" type="application/rss+xml" />`,
    ...posts.map((p) => item(p, base, channel)),
    '  </channel>',
    '</rss>',
    '',
  ].join('\n')
}
