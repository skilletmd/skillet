import Link from 'next/link'
import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { GitHubIcon, TwitterIcon } from '@/components/auth-provider-icons'
import { isSafeUntrustedHref } from '@/components/app-link'
import { FollowButton } from '@/components/follow-button'
import { ConnectAgentCta } from '@/components/connect-agent-cta'
import { AgentGlyph } from '@/components/agent-glyph'
import { Tooltip } from '@/components/ui/tooltip'
import { Check, VerifiedBadge } from '@/components/ui/icons'
import { GitHubMark } from '@/components/mirror-notice'
import { runtimeLabel } from '@/lib/runtime-labels'
import { avatarHue, readAvatarHue } from '@/lib/avatar-color'
import { heroWash } from '@/components/cover/hero-wash'
import type { AuthorProfile } from '@/lib/types'

// Compact so the stat row stays tidy: 3 → "3", 12,600 → "12.6K", 2.4M, etc.
function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatJoinedMonth(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(value))
}

/** The profile hero tint. Keyed to the person's avatar hue (their chosen shade
 *  when they picked one, else their stable auto hue) so the wash and the avatar
 *  always agree. Lower saturation than the skill/kit washes — a profile is a
 *  person, not cover art, so the band reads letterhead-quiet. */
export function profileHeroWash(author: string, avatarUrl?: string | null): string {
  return heroWash(author, readAvatarHue(avatarUrl) ?? avatarHue(author), 40)
}

function MetaDot() {
  return (
    <span aria-hidden="true" className="text-(--ink-2)/60">
      ·
    </span>
  )
}

/**
 * Full-width identity band for the profile and followers/following pages — the
 * same hero plan as the skill/kit DetailHeader (cover | title stack | action)
 * so all three catalog page types read as one system. Replaces the old left
 * identity rail: everything that lived there now sits on the header's meta
 * line, the bio slot, or the action column.
 */
export function ProfileHeader({
  profile,
  author,
  isSelf,
  isTeam,
  isAuthed,
  action,
  hideAvatar = false,
}: {
  profile: AuthorProfile
  author: string
  isSelf: boolean
  isTeam: boolean
  isAuthed: boolean
  /** Replaces the default action (Follow / Connect an agent) when set — e.g.
   *  the team-manager's "Manage team" button. */
  action?: ReactNode
  /** Render identity without the avatar — for the profile page, where the avatar
   *  leads the left rail (matching skill/kit). Followers/following keep the
   *  default inline avatar. */
  hideAvatar?: boolean
}) {
  const githubHandle = profile.socials?.github?.replace(/^@/, '') || null
  const twitterHandle = profile.socials?.twitter?.replace(/^@/, '') || null

  const runtimes = profile.runtimes ?? []
  const legacyRuntimes = profile.detectedRuntimes ?? []
  const hasAgents = runtimes.length > 0 || legacyRuntimes.length > 0

  // One wrapping meta line under the name, kit-page style: identity first,
  // then the numbers, links, teams, and the joined date — dot-separated.
  const meta: ReactNode[] = [
    <span key="handle" className="font-medium text-(--accent)">
      @{author}
    </span>,
  ]
  // Counts appear only once there is one to show. A zero argues against the
  // profile it sits on, and at launch every profile has zeros in every slot,
  // so the header would open with two arguments against itself. Same rule the
  // route skill already follows when it prints an author's standing.
  if (!isTeam && (profile.followers ?? 0) > 0) {
    meta.push(
      <Link
        key="followers"
        href={`/${author}/followers`}
        className="transition-colors hover:text-(--ink)"
      >
        <span className="font-semibold text-(--ink)">{formatNumber(profile.followers ?? 0)}</span>{' '}
        {profile.followers === 1 ? 'follower' : 'followers'}
      </Link>,
    )
  }
  if (!isTeam && !profile.isMirror && (profile.following ?? 0) > 0) {
    meta.push(
      <Link
        key="following"
        href={`/${author}/following`}
        className="transition-colors hover:text-(--ink)"
      >
        <span className="font-semibold text-(--ink)">{formatNumber(profile.following ?? 0)}</span>{' '}
        following
      </Link>,
    )
  }
  if (profile.totalInstalls > 0) {
    meta.push(
      <Link
        key="installs"
        href={`/${author}/installs`}
        className="transition-colors hover:text-(--ink)"
      >
        <span className="font-semibold text-(--ink)">{formatNumber(profile.totalInstalls)}</span>{' '}
        {profile.totalInstalls === 1 ? 'install' : 'installs'}
      </Link>,
    )
  }
  if (!isTeam) {
    for (const t of profile.teams ?? []) {
      meta.push(
        <Link
          key={`team-${t.slug}`}
          href={`/${t.slug}`}
          className="inline-flex min-w-0 items-center gap-1.5 font-medium text-(--ink) transition-colors hover:text-(--accent)"
        >
          <Avatar name={t.name} colorKey={t.slug} kind="team" size="xxs" aria-hidden="true" />
          <span className="min-w-0 truncate">{t.name}</span>
        </Link>,
      )
    }
  }

  // Default action: visitors get Follow; your own empty profile gets the
  // connect-an-agent nudge (once agents show, the glyph row carries the slot).
  const resolvedAction =
    action ??
    (!isSelf && !isTeam ? (
      <FollowButton
        author={author}
        initialFollowing={profile.followedByMe ?? false}
        isAuthed={isAuthed}
      />
    ) : isSelf && !isTeam && !hasAgents ? (
      <ConnectAgentCta />
    ) : null)


  const identityInner = (
    <>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h1 className="text-2xl font-semibold leading-[1.15] tracking-tight text-(--ink) sm:text-3xl">
          {profile.displayName}
        </h1>
        {profile.isMirror && (
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-(--line) bg-(--surface) px-2.5 py-1 text-xs font-medium text-(--ink-2)"
            title="This profile mirrors a GitHub repo. Its owner hasn't joined Skillet."
          >
            <GitHubMark className="h-3.5 w-3.5" />
            Mirror
          </span>
        )}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm text-(--ink-2)">
        {meta.map((item, i) =>
          i === 0 ? (
            item
          ) : (
            // Dot + item wrap as one unit so a line never ends on an orphan dot.
            <span key={`meta-${i}`} className="flex min-w-0 items-center gap-x-2.5">
              <MetaDot />
              {item}
            </span>
          ),
        )}
      </div>
    </>
  )

  return (
    <header>
      {hideAvatar ? (
        // Avatar-in-rail layout (profile page): identity then action, stacked.
        // This used to be justify-between, which floated Follow to the far right
        // edge of a wide column and left the name and its own button separated by
        // most of the viewport. DetailHeader states the rule for skill and kit
        // pages — "the primary action, grouped IN the block rather than floated
        // to a far corner" — and the profile is the page that was breaking it.
        // Same mt-5 / gap-3 action row as DetailHeader, so the three page types
        // put their buttons in the same place.
        <div className="min-w-0">
          {identityInner}
          {resolvedAction && (
            <div className="mt-5 flex flex-wrap items-center gap-3">{resolvedAction}</div>
          )}
        </div>
      ) : (
        // App-header grid, same as DetailHeader: avatar | text stack | action,
        // vertically centered. Mobile pushes the action to a full-width row below.
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
          <Avatar
            src={profile.avatarUrl}
            name={profile.displayName}
            colorKey={author}
            kind={isTeam ? 'team' : 'person'}
            size="lg"
            // The profile photo is the author page's above-the-fold LCP image.
            priority
            className="h-20 w-20 shrink-0 self-center sm:h-24 sm:w-24"
          />
          <div className="col-start-2 row-start-1 flex min-h-24 min-w-0 flex-col justify-center">
            {identityInner}
          </div>
          {resolvedAction && (
            <div className="col-span-2 col-start-1 row-start-2 mt-4 flex flex-col items-start gap-3 sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:mt-0 sm:items-end sm:self-center sm:pl-2">
              {resolvedAction}
            </div>
          )}
        </div>
      )}

      {!isTeam && (profile.followedByYouCount ?? 0) > 0 && (
        <p className="profile-mutuals mt-3">
          {'✓ '}
          Followed by{' '}
          {(profile.followedByYou ?? []).slice(0, 2).map((h, i, arr) => (
            <span key={h}>
              <Link href={`/${h}`} className="profile-mutual-link">
                @{h}
              </Link>
              {i < arr.length - 1 ? ', ' : ''}
            </span>
          ))}
          {(profile.followedByYouCount ?? 0) > 2
            ? ` and ${(profile.followedByYouCount ?? 0) - 2} others`
            : ''}
        </p>
      )}
    </header>
  )
}


function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      className={className}
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.2" />
      <path d="M1.8 8h12.4M8 1.8c-4.4 4.1-4.4 8.3 0 12.4 4.4-4.1 4.4-8.3 0-12.4z" />
    </svg>
  )
}

/**
 * AGENTS rail section — the profile's proof-of-work signal, labeled so a
 * visitor never has to hover to decode a facepile. Own caption on the page.
 */
export function ProfileAgentsRail({ profile }: { profile: AuthorProfile }) {
  const runtimes = profile.runtimes ?? []
  const legacyRuntimes = profile.detectedRuntimes ?? []
  if (runtimes.length === 0 && legacyRuntimes.length === 0) return null
  if (runtimes.length === 0) {
    return (
      <p className="text-sm text-(--ink-2)">{legacyRuntimes.map(runtimeLabel).join(', ')}</p>
    )
  }
  return (
    <ul className="flex flex-col gap-2 text-sm text-(--ink-2)">
      {runtimes.map((r) => {
        const label = runtimeLabel(r.key)
        return (
          <li key={r.key} className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-full border border-(--line) bg-(--surface) text-(--ink)">
              <AgentGlyph runtime={r.key} className="h-4 w-4" />
            </span>
            <span className="text-(--ink)">{label}</span>
            {r.verified && (
              <span className="inline-flex items-center gap-1 text-xs text-(--ink-2)">
                <VerifiedBadge className="h-3.5 w-3.5" />
                Verified
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Right-rail About block for the profile page — the skill permalink's About
 * pattern applied to a person: agents used, links, and the joined date live
 * here so the header stays name + numbers + one action.
 */
export function ProfileAboutRail({
  profile,
  isTeam,
}: {
  profile: AuthorProfile
  isTeam: boolean
}) {
  const githubHandle = profile.socials?.github?.replace(/^@/, '') || null
  const twitterHandle = profile.socials?.twitter?.replace(/^@/, '') || null
  // profileUrl is user-controlled and unvalidated on write, so guard the
  // scheme before rendering it as an href — React does NOT strip a
  // javascript: URL. When it isn't a safe http(s)/mailto link, show the
  // label as inert text (no anchor) instead of an executable link.
  // A mirror's profileUrl is usually the source repo — the MirrorNotice above
  // already names it, so drop the duplicate globe row.
  const repoPath = profile.mirrorSourceUrl?.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  const urlPath = profile.profileUrl?.replace(/^https?:\/\//i, '').replace(/\/$/, '')
  const urlLabel = (urlPath && urlPath !== repoPath && profile.profileUrl?.replace(/^https?:\/\//i, '')) || null
  const linkClass =
    'inline-flex min-w-0 items-center gap-1.5 text-(--ink-2) transition-colors hover:text-(--ink)'

  // Legacy mirror seeds ended the bio with this sentence; the rail's mirror
  // card says it now, so strip it from display (new seeds no longer carry it).
  const bio = profile.isMirror
    ? profile.bio?.replace(/\s*Synced from GitHub; unclaimed\.?\s*$/, '')
    : profile.bio

  return (
    <div className="flex flex-col gap-3.5 text-sm">
      {bio?.trim() && <p className="text-pretty leading-[1.6] text-(--ink)">{bio}</p>}
      {(githubHandle || twitterHandle || urlLabel) && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {githubHandle && (
            <a
              href={`https://github.com/${encodeURIComponent(githubHandle)}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`${profile.displayName} on GitHub`}
              className={linkClass}
            >
              <GitHubIcon className="h-4 w-4" />
              <span className="truncate">{githubHandle}</span>
            </a>
          )}
          {twitterHandle && (
            <a
              href={`https://x.com/${encodeURIComponent(twitterHandle)}`}
              target="_blank"
              rel="noreferrer"
              aria-label={`${profile.displayName} on X`}
              className={linkClass}
            >
              <TwitterIcon className="h-4 w-4" />
              <span className="truncate">{twitterHandle}</span>
            </a>
          )}
          {urlLabel &&
            (isSafeUntrustedHref(profile.profileUrl!) ? (
              <a
                href={profile.profileUrl!}
                target="_blank"
                rel="noreferrer"
                className={`${linkClass} max-w-[28ch]`}
              >
                <GlobeIcon className="h-4 w-4" />
                <span className="truncate">{urlLabel}</span>
              </a>
            ) : (
              <span className={`${linkClass} max-w-[28ch]`}>
                <GlobeIcon className="h-4 w-4" />
                <span className="truncate">{urlLabel}</span>
              </span>
            ))}
        </div>
      )}
      {!profile.isMirror && (
        <p className="text-xs text-(--ink-3)">
          {isTeam ? 'Created' : 'Joined'} {formatJoinedMonth(profile.joinedAt)}
        </p>
      )}
    </div>
  )
}
