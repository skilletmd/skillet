import Link from 'next/link'
import { KitCard } from '@/components/kit-card'
import { Avatar } from '@/components/ui/avatar'
import { CardXs } from '@/components/card/shells'
import { CoverArt } from '@/components/cover/cover'
import { humanizeSlug } from '@/components/skill-card'
import { ActorHoverName, PersonFacepile } from '@/components/person-hover-card'
import { authorKitHref, profileHref } from '@/lib/urls'
import { timeAgo } from '@/lib/feed-format'
import type {
  NotificationEvent,
  NotificationKit,
  NotificationSkill,
} from '@/lib/registry-notifications'

/** A run of same-kind notifications collapsed into one entry — follows together,
 *  each kit's adopters together, skill-subscribers together — so the page reads
 *  by kind instead of repeating "followed you" once per person. */
export interface NotificationGroup {
  kind: NotificationEvent['kind']
  /** Set for `subscribed_kit` groups (grouped per kit). */
  kit?: NotificationKit
  /** Set for `installed_skill` groups (grouped per skill). */
  skill?: NotificationSkill
  /** Set for `org_invited` groups (one per pending invite — never collapsed). */
  orgInvite?: { inviteId: string; role: string; orgSlug: string; orgName: string; inviter: string }
  actors: { handle: string; avatarUrl: string | null }[]
  at: number
}

/** Group inbound events: follows and skill-subscribes by kind, kit-adds by kit,
 *  skill-installs by skill. Actors are deduped; the group keeps the newest time. */
export function groupNotifications(events: NotificationEvent[]): NotificationGroup[] {
  const order: NotificationGroup[] = []
  const byKey = new Map<string, NotificationGroup>()
  for (const e of events) {
    // org_invited is keyed per invite id so two pending invites never collapse
    // into one row (each needs its own Accept link).
    const key =
      e.kind === 'subscribed_kit'
        ? `kit:${e.kit.kitId}`
        : e.kind === 'installed_skill'
          ? `skill:${e.skill.skillId}`
          : e.kind === 'proposal_received'
            ? `proposal:${e.skill.skillId}`
            : e.kind === 'version_blocked'
              ? `blocked:${e.skill.skillId}`
              : e.kind === 'org_invited'
                ? `invite:${e.inviteId}`
                : e.kind
    let g = byKey.get(key)
    if (!g) {
      g = {
        kind: e.kind,
        kit: e.kind === 'subscribed_kit' ? e.kit : undefined,
        skill:
          e.kind === 'installed_skill' ||
          e.kind === 'version_blocked' ||
          e.kind === 'proposal_received'
            ? e.skill
            : undefined,
        orgInvite:
          e.kind === 'org_invited'
            ? {
                inviteId: e.inviteId,
                role: e.role,
                orgSlug: e.org.slug,
                orgName: e.org.name,
                inviter: e.inviter,
              }
            : undefined,
        actors: [],
        at: e.at,
      }
      byKey.set(key, g)
      order.push(g)
    }
    // System events (version_blocked, org_invited) have no actor — skip facepile.
    if (
      e.kind !== 'version_blocked' &&
      e.kind !== 'org_invited' &&
      !g.actors.some((a) => a.handle === e.actor)
    ) {
      g.actors.push({ handle: e.actor, avatarUrl: e.actorAvatarUrl })
    }
    g.at = Math.max(g.at, e.at)
  }
  return order.sort((a, b) => b.at - a.at)
}

function FollowGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2.2c-4.6 0-8.2 2.5-8.2 5.6V22h16.4v-2.2c0-3.1-3.6-5.6-8.2-5.6Z" />
    </svg>
  )
}

function AdoptGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function TeamGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
    </svg>
  )
}

function ProposalGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function ShieldGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3Z" />
      <path d="M12 8v4M12 15.5h.01" />
    </svg>
  )
}

// The gutter glyph encodes the kind so the list scans by type — a person for
// follows, a plus for adoptions (someone adding your kit or subscribing to your
// skills). One muted treatment for all; the shape carries the meaning.
const TYPE: Record<NotificationEvent['kind'], { glyph: React.ReactNode; verb: string }> = {
  followed_you: { glyph: <FollowGlyph />, verb: 'followed you' },
  subscribed_kit: { glyph: <AdoptGlyph />, verb: 'added your kit' },
  // The author-kit is a kit (everything you publish), so it reads as "added your
  // kit" too — the tile (your avatar) distinguishes it from a named kit.
  subscribed_author: { glyph: <AdoptGlyph />, verb: 'added your kit' },
  installed_skill: { glyph: <AdoptGlyph />, verb: 'added your skill' },
  proposal_received: { glyph: <ProposalGlyph />, verb: 'proposed a change' },
  version_blocked: { glyph: <ShieldGlyph />, verb: 'was blocked by the scanner' },
  org_invited: { glyph: <TeamGlyph />, verb: 'invited you to their team' },
}

/** The viewer's own author-kit, mirrored from their profile so the
 *  subscribed_author tile renders the identical cover (mesh + avatar) and name
 *  as the real `/{handle}/kit` page. */
export interface ViewerAuthorKit {
  /** The kit's display name — the author's name (e.g. "taylor"). */
  name: string
  /** CoverArt seed: the member skill refs, matching the author-kit page. */
  seed: string
  categories: (string | null)[]
  avatarUrl: string | null
  initial: string
}

/**
 * One grouped notification: a color-coded type glyph in the gutter, a facepile
 * of the actors (each hoverable to a person card with Follow), a "lead and N
 * others <verb>" line, and the adopted kit/skill as context. Notifications are
 * authed-only, so the hover cards always have a live Follow.
 */
export function NotificationRow({
  group,
  viewerHandle,
  authorKit,
}: {
  group: NotificationGroup
  viewerHandle: string
  /** The viewer's own author-kit (cover + name) for the subscribed_author tile. */
  authorKit: ViewerAuthorKit
}) {
  const { glyph, verb } = TYPE[group.kind]

  // version_blocked is a system event — no actor, no facepile. Render the skill
  // that was pulled with a calm, non-alarming line.
  if (group.kind === 'version_blocked' && group.skill) {
    return (
      <li className="feed-item feed-item--slim !items-start">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--caution)/15 text-(--caution)">
          {glyph}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="feed-line feed-line--slim">
              A version of{' '}
              <span className="font-medium text-(--ink)">{humanizeSlug(group.skill.slug)}</span>{' '}
              {verb} and was pulled from installs.
            </p>
            <time
              className="feed-time shrink-0 pt-0.5"
              dateTime={new Date(group.at * 1000).toISOString()}
            >
              {timeAgo(group.at)}
            </time>
          </div>
          <div className="mt-2 flex">
            <CardXs
              href={group.skill.href}
              title={humanizeSlug(group.skill.slug)}
              mark={
                <CoverArt
                  seed={`${group.skill.author}/${group.skill.slug}`}
                  categories={[group.skill.category]}
                  className="absolute inset-0 h-full w-full"
                />
              }
            />
          </div>
        </div>
      </li>
    )
  }

  // org_invited is a system event — no actor, no facepile. Render the inviting
  // team with an Accept control. The control is a navigation link (styled as a
  // button) to the accept page, so all accept-time states live there, not here.
  if (group.kind === 'org_invited' && group.orgInvite) {
    const inv = group.orgInvite
    const acceptHref = `/settings/teams/accept?org=${encodeURIComponent(
      inv.orgSlug,
    )}&invite=${encodeURIComponent(inv.inviteId)}`
    return (
      <li className="feed-item feed-item--slim !items-start">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--accent-bg) text-(--accent)">
          {glyph}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <p className="feed-line feed-line--slim">
              {inv.inviter ? (
                <Link
                  href={profileHref(inv.inviter)}
                  className="font-medium text-(--ink) no-underline hover:underline"
                >
                  @{inv.inviter}
                </Link>
              ) : (
                <span className="font-medium text-(--ink)">Someone</span>
              )}{' '}
              invited you to{' '}
              <Link
                href={profileHref(inv.orgSlug)}
                className="font-medium text-(--ink) no-underline hover:underline"
              >
                {inv.orgName}
              </Link>{' '}
              as {inv.role}.
            </p>
            <time
              className="feed-time shrink-0 pt-0.5"
              dateTime={new Date(group.at * 1000).toISOString()}
            >
              {timeAgo(group.at)}
            </time>
          </div>
          <div className="mt-2 flex">
            {/* Label reads "View" not "Accept": this is a link to the accept
                landing page, where the real redeem happens — clicking here does
                not join the team. */}
            <Link
              href={acceptHref}
              className="inline-flex items-center rounded-lg bg-(--ink) px-3.5 py-1.5 text-sm font-semibold text-(--bg) no-underline hover:opacity-90"
            >
              View invitation
            </Link>
          </div>
        </div>
      </li>
    )
  }

  const lead = group.actors[0]
  const others = group.actors.length - 1
  return (
    <li className="feed-item feed-item--slim !items-start">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-(--accent-bg) text-(--accent)">
        {glyph}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <PersonFacepile people={group.actors} isAuthed />
          <time
            className="feed-time shrink-0 pt-1.5"
            dateTime={new Date(group.at * 1000).toISOString()}
          >
            {timeAgo(group.at)}
          </time>
        </div>
        <p className="feed-line feed-line--slim mt-1.5">
          <ActorHoverName handle={lead.handle} avatarUrl={lead.avatarUrl} isAuthed />
          {/* One span so the gap is the single flex gap after the name — splitting
              "and N others" from the verb left a double space between them. */}
          <span className="feed-verb">
            {others > 0 ? `and ${others} ${others === 1 ? 'other' : 'others'} ${verb}` : verb}
          </span>
        </p>
        {group.kit && (
          <div className="mt-2 flex">
            <KitCard
              size="xs"
              kitId={group.kit.kitId}
              href={group.kit.href}
              name={group.kit.name}
              owner={group.kit.owner}
              skillCount={group.kit.skillCount}
              skillCategories={group.kit.skillCategories ?? []}
            />
          </div>
        )}
        {group.skill && (
          <div className="mt-2 flex">
            <CardXs
              href={group.skill.href}
              title={humanizeSlug(group.skill.slug)}
              mark={
                <CoverArt
                  seed={`${group.skill.author}/${group.skill.slug}`}
                  categories={[group.skill.category]}
                  className="absolute inset-0 h-full w-full"
                />
              }
            />
          </div>
        )}
        {group.kind === 'subscribed_author' && (
          // They adopted your author-kit (everything you publish) — render the
          // identical tile as /{handle}/kit: the mesh + avatar cover and the
          // kit's real name, linking to the author-kit page.
          <div className="mt-2 flex">
            <Link
              href={authorKitHref(viewerHandle)}
              className="card-xs card-xs--square relative z-10"
            >
              {/* Mini author-kit cover, built for this size: the mesh ground
                  fills the rounded-square mark (no over-rounding), with the
                  avatar centered and larger than the big-cover default. */}
              <span className="card-xs-mark">
                <CoverArt
                  seed={authorKit.seed}
                  categories={authorKit.categories}
                  groundOnly
                  className="absolute inset-0 h-full w-full"
                />
                <span className="absolute inset-0 flex items-center justify-center">
                  <Avatar
                    src={authorKit.avatarUrl}
                    name={authorKit.name}
                    colorKey={viewerHandle}
                    className="h-[66%] w-[66%] border border-(--line)"
                  />
                </span>
              </span>
              <span className="card-xs-label">{authorKit.name}</span>
            </Link>
          </div>
        )}
      </div>
    </li>
  )
}
