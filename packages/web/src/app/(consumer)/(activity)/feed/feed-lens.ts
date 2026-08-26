// Pure feed-lens helpers shared by the server surface and the client tab bar —
// no server or client imports, so both can use it. The feed is one content type
// (activity); "For you" vs "Global" vs a team are lenses on the same stream. For
// you is the bare /feed; the others are path segments: /feed/global, /feed/team/<slug>.

export type FeedSurfaceView = 'following' | 'discover' | 'team'

// The activity destinations are three top-level routes: /feed (Activity),
// /notifications, /updates. The section nav (shared across all three via the
// activity shell) reads the first path segment to know which is active. Activity's
// lens controls (For you / Global / team) and type filter render only on /feed.
export type FeedSection = 'activity' | 'notifications' | 'updates'

export function parseFeedSection(pathname: string): FeedSection {
  const seg = pathname.split('/').filter(Boolean)[0]
  if (seg === 'notifications') return 'notifications'
  if (seg === 'updates') return 'updates'
  return 'activity'
}

// The stream mixes event kinds; `?type=` narrows it to one. Kept as a query param
// (not a path segment) since it layers on top of any lens.
export type FeedEventType = 'skill' | 'follow' | 'subscribe' | 'signal'

export function parseEventType(value: string | string[] | undefined): FeedEventType | null {
  const v = Array.isArray(value) ? value[0] : value
  return v === 'skill' || v === 'follow' || v === 'subscribe' || v === 'signal' ? v : null
}

/**
 * The two things Global mixes, as a viewer-facing filter. "News" is what people
 * said off-platform; "Activity" is what happened in the registry. Kept to those
 * two because they are the split a reader actually feels — the finer event kinds
 * (`follow`, `subscribe`) are plumbing, and `follow` never renders anyway.
 */
export const FEED_FILTERS = [
  { key: null, label: 'Everything' },
  { key: 'signal' as const, label: 'News' },
  { key: 'skill' as const, label: 'Activity' },
]

/** The only explicit lens path segment served by /feed/[lens]. For you is the bare
 *  /feed and Global is /feed/global; team lenses have their own /feed/team/<slug>
 *  route. The [lens] route notFound()s anything else — this is the single source of
 *  truth for that guard (and the URL-scheme cutover: /feed/foryou and /feed/discover
 *  no longer resolve). */
export function isFeedLensSegment(seg: string | undefined): boolean {
  return seg === 'global'
}

export function parseLens(value: string | undefined, isAuthed: boolean): FeedSurfaceView {
  if (value === 'discover' || value === 'global') return 'discover'
  if (value === 'team') return 'team'
  if (value === 'foryou' || value === 'following') return isAuthed ? 'following' : 'discover'
  return isAuthed ? 'following' : 'discover'
}

/** Extract the lens + team slug from a /feed pathname. Bare /feed resolves to no
 *  explicit lens (For you is the default); /feed/global and /feed/team/<slug> carry
 *  theirs. Only ever called on /feed paths — top-level /notifications and /updates
 *  are sections, not lenses. */
export function feedPathState(pathname: string): { lens?: string; teamSlug?: string } {
  const parts = pathname.split('/').filter(Boolean) // ['feed', a?, b?]
  if (parts[1] === 'team') return { lens: 'team', teamSlug: parts[2] }
  return { lens: parts[1] }
}
