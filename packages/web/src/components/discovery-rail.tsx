import Link from 'next/link'
import { FollowButton } from '@/components/follow-button'
import { Avatar } from '@/components/ui/avatar'
import { ArrowRight } from '@/components/ui/icons'
import type { FollowSuggestion } from '@/lib/registry'
import { pluralize } from '@/lib/format'

/**
 * The right-rail discovery modules — who-to-follow + the install nudge — shared by
 * the feed and the homepage (the two "discover" surfaces). Per the role-based
 * rail model: left rails filter/navigate, right rails discover. One definition so
 * both surfaces stay in lockstep.
 */

/**
 * An actor avatar that links to the profile: a real uploaded image (e.g. a synced
 * brand's GitHub logo) when one exists, else the illustrated default face on its
 * soft tinted circle — the same species as the shared {@link Avatar}. `className`
 * carries the size/shape (feed-avatar, feed-avatar--sm, wtf-avatar).
 */
export function FeedAvatar({
  handle,
  avatarUrl,
  className,
}: {
  handle: string
  avatarUrl: string | null
  className: string
}) {
  // The CSS class carries the link's size/shape; the shared Avatar fills it.
  return (
    <Link href={`/${handle}`} className={className} aria-label={`@${handle}`}>
      <Avatar src={avatarUrl} name={handle} colorKey={handle} className="h-full w-full" />
    </Link>
  )
}

/**
 * Who-to-follow module. Renders nothing when there's no one to suggest. When
 * `isAuthed` is false (logged-out feed), the rows are still shown as a discovery
 * teaser but the Follow buttons are dropped — there's no session to follow with.
 */
export function WhoToFollow({
  suggestions,
  isAuthed = true,
}: {
  suggestions: FollowSuggestion[]
  isAuthed?: boolean
}) {
  if (suggestions.length === 0) return null
  return (
    <div className="wtf-card">
      <div className="group/shelf flex items-baseline justify-between gap-3 px-0.5 pb-2.5">
        <span className="text-xs font-semibold uppercase tracking-[0.05em] text-(--ink-2)">
          Who to follow
        </span>
        <Link
          href="/browse/people"
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-[0.05em] text-(--ink-2) transition-colors hover:text-(--accent) group-hover/shelf:text-(--accent)"
        >
          See all
          <ArrowRight className="opacity-0 transition-[opacity,transform] duration-200 group-hover/shelf:translate-x-0.5 group-hover/shelf:opacity-100" />
        </Link>
      </div>
      <ul>
        {suggestions.map((s) => (
          <li key={s.handle} className="wtf-row">
            <FeedAvatar handle={s.handle} avatarUrl={s.avatarUrl} className="wtf-avatar" />
            <Link href={`/${s.handle}`} className="wtf-meta">
              <span className="wtf-name">{s.name}</span>
              <span className="wtf-sub">
                @{s.handle} · {s.skills} {pluralize(s.skills, 'skill')}
              </span>
            </Link>
            {isAuthed && (
              <FollowButton
                author={s.handle}
                initialFollowing={false}
                isAuthed
                appearance="card"
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

