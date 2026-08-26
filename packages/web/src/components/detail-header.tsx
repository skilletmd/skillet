import Link from 'next/link'
import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { PersonHoverName } from '@/components/person-hover-card'
import { PAGE_EYEBROW_CLASS } from '@/lib/page-layout'

/** Placement for the leading cover: column 1 of the header grid, with its own
 *  right gutter so hiding the box takes the gap with it. */
export const DETAIL_MEDIA_SLOT = 'col-start-1 row-start-1 me-4 sm:me-5'

/** Placement for the page's action: right of the title, on the title's row. */
export const DETAIL_ACTION_SLOT = 'col-start-3 row-start-1 justify-self-end'

/** Placement for whatever answers the action (the post-Add delivery bar): its
 *  own row underneath, running the full width of the header. Empty until the
 *  bar has something to say, and an empty row costs no height. */
export const DETAIL_ACTION_FOOTER = 'col-span-full row-start-2'

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
  description,
  badges,
  byline,
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
  /**
   * Replaces the "KIT BY @owner" eyebrow with the person themselves — avatar,
   * name, handle, Follow — on the line above the title. "KIT BY @wshobson" made
   * the reader do the lookup; the face and the real name are the trust signal,
   * and they were sitting in a rail the phone does not even show first. Pass
   * AuthorAboutRow's `inline` variant. Without it the eyebrow is unchanged.
   */
  byline?: ReactNode
  /** Drop "by @owner" from the eyebrow — the author-kit's title already names
   *  the author, so it would just repeat. */
  hideByline?: boolean
  /** Private object — prepends a lock + "Private" to the eyebrow label. */
  isPrivate?: boolean
  description?: string | null
  /** Inline state badges (eval…) shown on the byline row. */
  badges?: ReactNode
  /** State of the OBJECT itself (private) — sits beside the eyebrow, like the kit
   *  hero, so it reads as the object's state and not the author's. */
  titleBadge?: ReactNode
  /**
   * Leading cover, left of the identity block at EVERY width. The caller supplies
   * the whole box — size, radius, ring, its own `me-*` gutter, and the placement
   * classes {@link DETAIL_MEDIA_SLOT} — because the detail pages show this square
   * only on phones (from lg the cover moves to the rail at full size) and only
   * the caller knows that. Hidden, it leaves no empty column: the gutter travels
   * with the box, and column 1 collapses to zero.
   */
  media?: ReactNode
  /**
   * The page's action, laid out on the header grid rather than stacked under the
   * description — Add belongs beside the name it applies to, at a fixed spot the
   * eye can return to.
   *
   * Every action node must carry its own placement, so wrap each part in the
   * matching constant: {@link DETAIL_ACTION_SLOT} for the button (right of the
   * title) and {@link DETAIL_ACTION_FOOTER} for anything that answers it — the
   * post-Add delivery bar — which runs the full width on its own row underneath.
   * A node may be a fragment of both. DetailHeader cannot wrap them for you: it
   * would have to guess which part is which, and the two-piece actions keep
   * their state in one component that has to render both halves itself.
   */
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
      {/* A grid, not a flex row: the action slot needs a cell beside the title
          AND a full-width row under it, and `display: contents` lets a
          two-piece action drop its own children into both. Column gaps are
          margins on the items instead of `gap-x`, because a grid gap survives
          an empty column — and column 1 IS empty from lg up, where the cover
          moves to the rail. */}
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center">
        {media}
        <div className="col-start-2 row-start-1 min-w-0 pe-4">
          {/* "SKILL BY @author" — type + author on one eyebrow line, author-
              forward because who made it is the trust signal. Title + description
              sit adjacent below. */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {byline && !hideByline ? (
              <>
                {/* The object's own state still leads — it describes the kit,
                    not the person standing next to it. */}
                {isPrivate && (
                  <p className={`${PAGE_EYEBROW_CLASS} inline-flex items-center gap-1`}>
                    <LockGlyph />
                    Private {kind}
                  </p>
                )}
                {byline}
              </>
            ) : (
              <>
                <p className={`${PAGE_EYEBROW_CLASS} inline-flex items-center gap-1`}>
                  {isPrivate && <LockGlyph />}
                  {isPrivate ? 'Private ' : ''}
                  {hideByline ? kind : `${kind} by`}
                </p>
                {!hideByline && (
                  <PersonHoverName handle={owner}>
                    <Link
                      href={`/${owner}`}
                      className="shrink-0 text-sm font-semibold text-(--ink) transition-colors hover:text-(--accent)"
                    >
                      @{owner}
                    </Link>
                  </PersonHoverName>
                )}
              </>
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
        </div>
        {action && <div className="contents">{action}</div>}
      </div>
      {/* Only the eyebrow + title sit beside the cover. The description and the
          runtime reach run the full width below, so they start at the page
          margin instead of hanging off a 64px indent that ends two lines above
          them. */}
      {/* Tagline right under the title (App Store subtitle / Spotify order). */}
      {description?.trim() && (
        <p className="mt-2.5 max-w-[60ch] text-sm leading-[1.55] text-(--ink-2) sm:text-base">
          {description}
        </p>
      )}
      {worksWith && <div className="mt-4">{worksWith}</div>}
    </header>
  )
}
