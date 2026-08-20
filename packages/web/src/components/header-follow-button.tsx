'use client'

import { useSession } from 'next-auth/react'
import { FollowButton } from '@/components/follow-button'

/**
 * The Follow chip in a detail-page byline (the skill/kit hero, beside @owner).
 *
 * A thin client wrapper so Follow works on the CDN-cached skill page: it reads
 * the viewer from the client session rather than a server prop, hides itself on
 * your own objects (you can't follow yourself), and otherwise defers to
 * {@link FollowButton} + the shared follow graph for the actual state. It stays
 * blank until the session resolves, so a logged-in owner never sees a flashed
 * "Follow" on their own page. `initialFollowing` is a throwaway false — the
 * app-wide FollowsProvider (bootstrapped from the server) supplies the real
 * state the moment it's mounted.
 */
export function HeaderFollowButton({
  owner,
  isTeam,
  appearance = 'inline',
  showHandle = false,
}: {
  owner: string
  isTeam?: boolean
  /** 'inline' = chromeless byline link (default); 'secondary' = an outlined pill
   *  that pairs with a primary Add on a detail hero. */
  appearance?: 'inline' | 'secondary'
  showHandle?: boolean
}) {
  const { data: session, status } = useSession()
  // Teams aren't followable — same gate the profile header uses.
  if (isTeam) return null
  // Unknown viewer: render nothing rather than risk flashing Follow on an owner's
  // own page. Logged-out visitors resolve to `unauthenticated` and do get the
  // chip (it routes them to login), matching how Add greets logged-out users.
  if (status === 'loading') return null
  if (session?.handle && session.handle === owner) return null
  return (
    <FollowButton
      author={owner}
      initialFollowing={false}
      isAuthed={status === 'authenticated'}
      appearance={appearance}
      showHandle={showHandle}
    />
  )
}
