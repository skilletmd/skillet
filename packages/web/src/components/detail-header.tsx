import Link from 'next/link'
import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { PersonHoverName } from '@/components/person-hover-card'
import { PAGE_EYEBROW_CLASS } from '@/lib/page-layout'

/** Small lock, sized for the eyebrow — marks a private object inline in the
 *  "PRIVATE SKILL BY …" label rather than as a separate floating badge. */
function LockGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/**
 * Shared hero header for object detail pages (skill). One composed identity block
 * beside a leading cover, mirroring the kit hero ({@link RecipeBoxHero}) at a
 * smaller cover so a skill and a kit read as one family: eyebrow (SKILL / KIT) →
 * title → byline → description → runtime reach → the primary action, grouped IN
 * the block rather than floated to a far corner. The cover stays intentionally
 * smaller than a kit's — that size gap is the type differentiator.
 */
export function DetailHeader({
  kind,
  title,
  owner,
  ownerAvatarUrl,
  ownerIsTeam,
  description,
  follow,
  badges,
  titleBadge,
  media,
  action,
  version,
  updated,
  worksWith,
  hideByline,
  isPrivate,
}: {
  kind: 'skill' | 'kit'
  title: string
  owner: string
  /** Drop "by @owner" from the eyebrow — the author-kit's title already names
   *  the author, so it would just repeat. */
  hideByline?: boolean
  /** Private object — prepends a lock + "Private" to the eyebrow label. */
  isPrivate?: boolean
  /** Owner avatar shown next to the @handle. */
  ownerAvatarUrl?: string | null
  /** Owner is a team/org — avatar renders as a monogram square, not a face. */
  ownerIsTeam?: boolean
  description?: string | null
  /** Follow button, grouped with the primary action (never on your own objects —
   *  the control hides itself for the owner). */
  follow?: ReactNode
  /** Inline state badges (eval…) shown on the byline row. */
  badges?: ReactNode
  /** State of the OBJECT itself (private) — sits beside the eyebrow, like the kit
   *  hero, so it reads as the object's state and not the author's. */
  titleBadge?: ReactNode
  /**
   * Leading cover (left of the identity block). The caller supplies a fully-styled
   * `h-full w-full` node — a square skill mosaic / category cover — so every object
   * page leads with its own identity in the same slot.
   */
  media?: ReactNode
  /** Primary action (Add), grouped with `follow` under the description. */
  action?: ReactNode
  /** Version label on the byline (e.g. `v1.0.0`). */
  version?: string
  /** Pre-formatted freshness on the byline (e.g. `Updated Jun 29`). */
  updated?: string
  /** Runtime reach ("Works everywhere" + logos) above the actions, like the kit. */
  worksWith?: ReactNode
}) {
  return (
    <header>
      <div className="grid items-start gap-6 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-8">
        {media && <div className="size-28 shrink-0 sm:size-32">{media}</div>}
        <div className="min-w-0">
          {/* "SKILL BY @author" — type + author on one eyebrow line, author-
              forward because who made it is the trust signal. Title + description
              sit adjacent below. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className={`${PAGE_EYEBROW_CLASS} inline-flex items-center gap-1`}>
              {isPrivate && <LockGlyph />}
              {isPrivate ? 'Private ' : ''}
              {hideByline ? kind : `${kind} by`}
            </p>
            {!hideByline && (
              <PersonHoverName handle={owner}>
                <Link
                  href={`/${owner}`}
                  className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-(--ink) transition-colors hover:text-(--accent)"
                >
                  <Avatar
                    name={owner}
                    src={ownerAvatarUrl}
                    colorKey={owner.replace(/^@/, '')}
                    kind={ownerIsTeam ? 'team' : 'person'}
                    size="xxs"
                    aria-hidden="true"
                  />
                  <span>@{owner}</span>
                </Link>
              </PersonHoverName>
            )}
            {badges}
            {titleBadge}
          </div>
          {/* Same title style as the kit hero (bold, size-specific negative
              tracking), just a smaller size — so a skill and a kit read as one
              family scaled, not two different treatments. */}
          <h1 className="mt-1 text-2xl font-bold leading-[1.1] tracking-[-0.02em] text-(--ink) sm:text-3xl">
            {title}
          </h1>
          {/* Tagline right under the title (App Store subtitle / Spotify order). */}
          {description?.trim() && (
            <p className="mt-2.5 max-w-[60ch] text-sm leading-[1.55] text-(--ink-2) sm:text-base">
              {description}
            </p>
          )}
          {worksWith && <div className="mt-4">{worksWith}</div>}
          {(action || follow) && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {action}
              {follow}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
