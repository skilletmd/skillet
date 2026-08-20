import { NextResponse } from 'next/server'
import { getFeed, getDiscoverFeed, type FeedResult } from '@/lib/registry'

/**
 * One page of the activity feed as plain JSON — the client infinite-scroll
 * fetches this instead of calling a Server Action, so paging never triggers a
 * route refresh (which would reset scroll). The first page is still server-
 * rendered by the feed surface; this serves every page after it.
 *
 * Mirrors the surface's fetch: `view` is already resolved client-side, so we
 * trust it. Follows are stripped (they live in notifications) and an optional
 * `type` narrows to one kind, matching the initial render.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const view = url.searchParams.get('view') ?? 'following'
  const team = url.searchParams.get('team') ?? undefined
  const type = url.searchParams.get('type')
  const offset = Math.min(Math.max(Number(url.searchParams.get('offset') ?? '0'), 0), 10_000)
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '8'), 1), 100)

  let feed: FeedResult | null = null
  if (view === 'discover') {
    feed = await getDiscoverFeed({ withSession: true }, offset, limit)
  } else if (view === 'team' && team) {
    feed = await getFeed('team', { withSession: true }, team, offset, limit)
  } else {
    feed = await getFeed('following', { withSession: true }, undefined, offset, limit)
  }

  const events = (feed?.events ?? [])
    .filter((e) => e.kind !== 'follow')
    .filter((e) => (type ? e.kind === type : true))

  return NextResponse.json({ events, nextOffset: feed?.nextCursor ?? null })
}
