import { getStories } from '@/lib/blog'
import { buildBlogFeed, NEWS_CHANNEL } from '@/lib/blog-feed'

/**
 * Skillet Daily's story feed.
 *
 * Same builder as the blog's, over stories only, with items pointing at their
 * /news/<slug> permalinks. A static segment beats the sibling [story] route, so
 * this does not collide with a story slugged "rss.xml".
 *
 * The masthead has linked here since the page shipped; until now that link 404d.
 */
const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://skillet.md'

export async function GET() {
  return new Response(buildBlogFeed(getStories(), BASE, NEWS_CHANNEL), {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
