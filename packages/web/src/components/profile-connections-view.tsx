import Link from 'next/link'
import { auth } from '@/auth'
import { PeopleList } from '@/components/people-list'
import { ProfileTabs } from '@/components/profile-tabs'
import { getFollowList, getAdopters } from '@/lib/registry'

export type ConnectionsTab = 'followers' | 'following' | 'installs'

/**
 * The main-column content for a profile's connections — Followers / Following /
 * Installs as three tabs over the same people-list, opening on whichever route
 * was visited, plus a link back to the full profile. The shell (identity band +
 * sidebar rail) is owned by the shared (profile) layout, so this renders only
 * the content column and navigating between these tabs never re-renders the shell.
 */
export async function ProfileConnectionsView({
  author,
  initial,
}: {
  author: string
  initial: ConnectionsTab
}) {
  const session = await auth()
  const [followers, following, adopters] = await Promise.all([
    getFollowList(author, 'followers'),
    getFollowList(author, 'following'),
    getAdopters(author),
  ])

  const isSelf = session?.handle != null && session.handle === author

  // Installs = the public "Used by" audience (saved into a kit or subscribed).
  // Raw skill installs are excluded — installer identity is private to the author.
  const installsIntro = isSelf
    ? 'People who’ve added your skills and kits (saved into a kit or subscribed).'
    : `People who’ve added @${author}’s skills and kits (saved into a kit or subscribed).`
  const installsEmpty = isSelf
    ? 'No one has saved or subscribed to your skills or kits yet.'
    : `No one has saved or subscribed to @${author}’s skills or kits yet.`

  return (
    <>
      <div className="mb-6">
        <Link
          href={`/${author}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-(--ink-2) transition-colors hover:text-(--ink)"
        >
          <span aria-hidden="true">←</span> Back to profile
        </Link>
      </div>

      <ProfileTabs
        initial={initial}
        tabs={[
          { key: 'followers', label: 'Followers', count: followers.count },
          { key: 'following', label: 'Following', count: following.count },
          { key: 'installs', label: 'Installs', count: adopters.count },
        ]}
        panels={{
          followers: <PeopleList people={followers.people} empty="No followers yet." />,
          following: (
            <PeopleList people={following.people} empty={`@${author} isn’t following anyone yet.`} />
          ),
          installs: (
            <div>
              <p className="mb-6 max-w-[720px] text-sm leading-relaxed text-(--ink-2)">
                {installsIntro}
              </p>
              <PeopleList people={adopters.people} empty={installsEmpty} />
            </div>
          ),
        }}
      />
    </>
  )
}
