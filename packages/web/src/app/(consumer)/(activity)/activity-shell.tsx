import { auth } from '@/auth'
import { listMyOrgs } from '@/lib/orgs-server'
import { getFollowSuggestions, getPeopleCatalog, type FollowSuggestion } from '@/lib/registry'
import { WhoToFollow } from '@/components/discovery-rail'
import { markDynamicRoute } from '@/lib/mark-dynamic-route'
import { ActivityViewerCard } from './activity-viewer-card'
import { FeedRailSignin } from './feed-rail-signin'
import { FeedSectionNav } from './feed/feed-tabs'

// The activity shell — viewer mini-profile, the Feed section nav (Feed /
// Notifications / Updates), and the who-to-follow rail. The section nav lives in the
// left rail; the center shows the active section. Authed-only — logged-out visitors
// see no left rail (Notifications/Updates require a session; Global feed fills the
// center).

export async function loadLensProps() {
  await markDynamicRoute()
  const session = await auth()
  const isAuthed = !!session?.handle
  const orgsResult = isAuthed ? await listMyOrgs() : { kind: 'unauthorized' as const }
  const teams = orgsResult.kind === 'ok' ? orgsResult.orgs : []
  return { teams, isAuthed, handle: session?.handle ?? null, image: session?.user?.image ?? null }
}

/** The left rail: the viewer identity card over the Feed section nav. Both read the
 *  already-known client session, so they render instantly with no fetch and no
 *  skeleton, and survive navigation. The viewer card and section nav are both
 *  authed-only; logged-out viewers get a sign-in card in their place. */
export function ActivityLeftRail() {
  return (
    // pt-5 (20px) is the shared top inset for all three columns: it matches the
    // right rail's .wtf-card padding (20px) and the center's tab-label / section-
    // header inset, so the viewer name, "For you" / section title, and "Who to
    // follow" all start on one line — avatar and @handle hang off it.
    <div className="flex flex-col gap-5 pt-5">
      <ActivityViewerCard />
      <FeedSectionNav />
      <FeedRailSignin />
    </div>
  )
}

/** The right discovery rail — who to follow. */
export async function ActivityWhoToFollowRail() {
  const session = await auth()
  const isAuthed = !!session?.handle
  // Logged in: personalized suggestions (/me). Logged out: fall back to the
  // popular people directory so the rail still teases who's worth following —
  // the Follow buttons are dropped since there's no session to act with.
  let suggestions: FollowSuggestion[] = []
  try {
    suggestions = isAuthed
      ? await getFollowSuggestions({ withSession: true })
      : (await getPeopleCatalog({ limit: 5 })).items.map((p) => ({
          handle: p.handle,
          name: p.name,
          avatarUrl: p.avatarUrl,
          skills: p.publicSkills,
          followers: p.followers,
        }))
  } catch {
    suggestions = []
  }
  return (
    <div className="surface-aside-stack">
      <WhoToFollow suggestions={suggestions} isAuthed={isAuthed} />
    </div>
  )
}
