import { getEditorialPosts } from '@/lib/blog'
import { buildBlogFeed } from '@/lib/blog-feed'

// The blog's RSS feed. Same shape as app/robots.txt/route.ts: a directory named
// for the file, a GET returning a Response with an explicit content type and
// cache header. A static segment beats the sibling [slug] route, so this does
// not collide with a post named "rss.xml".
//
// The document itself is built by a pure function in lib/blog-feed.ts so the
// escaping and ordering rules are unit-tested without standing up a server.

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://skillet.md'

export async function GET() {
  return new Response(buildBlogFeed(getEditorialPosts(), BASE), {
    headers: {
      'content-type': 'application/rss+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  })
}
