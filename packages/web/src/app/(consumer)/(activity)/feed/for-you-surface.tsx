import Image from 'next/image'
import {
  getFeed,
  getDiscoverFeed,
  getFollowSuggestions,
  type FeedResult,
  type FollowSuggestion,
} from '@/lib/registry'
import { WhoToFollow } from '@/components/discovery-rail'
import { FeedRows } from './feed-rows'
import { FeedPanel } from './feed-panel'
import { parseLens, type FeedSurfaceView, type FeedEventType } from './feed-lens'
import { listMyOrgs } from '@/lib/orgs-server'
import { getSession } from '@/lib/get-session'
import { feedGlobalHref, feedHref, loginHref } from '@/lib/urls'

export type { FeedSurfaceView }

// Events per page for the feed's infinite scroll — large enough that the first
// screen is full, small enough to keep the initial payload light.
const FEED_PAGE_SIZE = 30

/** Suggestions for the empty For-you state. Soft-fails to an empty list: a
 *  suggestions outage should cost the rows, not the empty state around them. */
async function loadFollowSuggestions(): Promise<FollowSuggestion[]> {
  try {
    return await getFollowSuggestions({ withSession: true })
  } catch {
    return []
  }
}

/**
 * The feed body (For you / Discover / a team). Fetches the first page server-
 * side, then hands it to the client {@link FeedRows}, which renders it and pages
 * the rest via the `/api/feed` route handler (client fetch — no route refresh,
 * so scroll is preserved). The tab bar lives on the /feed page.
 */
export async function ForYouSurface({
  lens,
  teamParam,
  typeFilter,
}: {
  lens?: string
  teamParam?: string
  typeFilter?: FeedEventType | null
}) {
  // Identity for the feed lens comes from the request-cached session (a JWT
  // decode), not a live /whoami round-trip — same isAuthed/handle facts, no fetch.
  const session = await getSession()
  const isAuthed = !!session?.user
  const viewerHandle = session?.handle ?? null
  const view = parseLens(lens, isAuthed)

  // A team view is only valid for a member; fall back to Following otherwise.
  let activeTeam: string | null = null
  if (view === 'team' && teamParam && isAuthed) {
    const orgsResult = await listMyOrgs()
    const myTeams = orgsResult.kind === 'ok' ? orgsResult.orgs : []
    activeTeam = myTeams.some((t) => t.slug === teamParam) ? teamParam : null
  }
  const resolved: FeedSurfaceView = view === 'team' && !activeTeam ? 'following' : view

  let feed: FeedResult | null = null
  if (resolved === 'discover') {
    feed = isAuthed
      ? await getFeed('discover', { withSession: true }, undefined, undefined, FEED_PAGE_SIZE)
      : await getDiscoverFeed({}, undefined, FEED_PAGE_SIZE)
  } else if (resolved === 'team' && activeTeam) {
    feed = await getFeed('team', { withSession: true }, activeTeam, undefined, FEED_PAGE_SIZE)
  } else if (resolved === 'following' && isAuthed) {
    feed = await getFeed('following', { withSession: true }, undefined, undefined, FEED_PAGE_SIZE)
  }

  // Follows are excluded from the activity stream entirely — "X followed Y" is the
  // lowest-signal event and its discovery value already lives in the Who-to-follow
  // rail; inbound follows ("X followed you") live in notifications. `?type=` then
  // narrows what remains to one kind, client-selected in the rail.
  const events = (feed?.events ?? [])
    .filter((e) => e.kind !== 'follow')
    .filter((e) => (typeFilter ? e.kind === typeFilter : true))

  // An empty For-you feed renders its own empty state; it never redirects. Bare
  // /feed IS the For-you tab's href, so redirecting an empty following feed to
  // Global made the tab impossible to open and left no way to learn why. The empty
  // state below carries the fix instead (who to follow, right there).
  const emptyFollowing = resolved === 'following' && isAuthed && !typeFilter && events.length === 0
  const suggestions = emptyFollowing ? await loadFollowSuggestions() : []

  let body: React.ReactNode
  if (resolved === 'following' && !isAuthed) {
    body = (
      <FeedPanel
        title="Sign in to see who you follow"
        body="Follow the people whose skills are worth running, and their activity shows up here."
        cta={{ href: loginHref(feedHref()), label: 'Sign in' }}
      />
    )
  } else if (events.length > 0) {
    body = (
      <FeedRows
        initial={events}
        isAuthed={isAuthed}
        viewerHandle={viewerHandle}
        view={resolved}
        team={activeTeam}
        type={typeFilter ?? null}
        pageSize={FEED_PAGE_SIZE}
        nextOffset={feed?.nextCursor ?? null}
      />
    )
  } else if (feed && typeFilter) {
    body = (
      <FeedPanel
        title="Nothing of this type yet"
        body="No activity matches this filter right now. Try a different one, or switch to All."
      />
    )
  } else if (resolved === 'discover') {
    body = (
      <FeedPanel title="Quiet right now" body="No recent activity across Skillet. Check back soon." />
    )
  } else if (resolved === 'team') {
    body = (
      <FeedPanel
        title="Nothing from your team yet"
        body="When your teammates publish or update skills, they show up here."
      />
    )
  } else {
    // The one empty state a viewer can act on from where they stand: follow rows
    // inline (the right rail that normally carries them is hidden below lg, which
    // is exactly where an empty feed feels most like a dead end), with Global as
    // the way out for anyone who would rather browse first.
    body = (
      <FeedPanel
        title="Your feed is empty"
        body="Follow people and their activity lands here."
        cta={{ href: feedGlobalHref(), label: 'Browse the global feed' }}
        illustration={
          <Image
            src="/illustrations/empty-feed.png"
            alt=""
            width={170}
            height={240}
            className="empty-illo h-24 w-auto"
          />
        }
      >
        {/* lg:hidden — at lg and up the right rail already carries this exact
            list, and two copies on one screen is just noise. Below lg the rail is
            gone, which is where an empty feed reads as a dead end. */}
        {suggestions.length > 0 ? (
          <div className="lg:hidden">
            <WhoToFollow suggestions={suggestions} />
          </div>
        ) : null}
      </FeedPanel>
    )
  }

  // Just the timeline — the two-column shell + who-to-follow rail live in the
  // feed layout so they don't re-render (or re-fetch) when you switch lenses.
  return body
}
