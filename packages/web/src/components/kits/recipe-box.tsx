'use client'

/**
 * The cover-forward kit hero: the generative kit cover blown up and mounted,
 * with the kit's identity + primary actions beside it. Uses the production
 * cover engine (PaintedCover). This replaces only the hero band; the skills
 * inside a kit keep rendering through the existing KitSkillList so the list
 * stays consistent with the rest of the app (no net-new units).
 *
 * User-facing copy says "kit" / "skills".
 */

import { type ReactNode } from 'react'
import Link from 'next/link'
import { PaintedCover } from '@/components/cover/painted-cover'
import { kitCoverCategories } from '@/components/directory-card'
import { Avatar } from '@/components/ui/avatar'
import { PersonHoverName } from '@/components/person-hover-card'
import { PrivateMark } from '@/components/visibility-badge'
import { timeAgo } from '@/lib/feed-format'
import { PAGE_EYEBROW_CLASS } from '@/lib/page-layout'

const fmt = (n: number): string => n.toLocaleString('en-US')

export function RecipeBoxHero({
  kitId,
  name,
  owner,
  ownerAvatar,
  ownerIsTeam,
  description,
  updatedAt,
  skillCount,
  categories,
  coverNode,
  hideByline,
  isPrivate,
  action,
  follow,
}: {
  kitId: string
  name: string
  owner: string
  ownerAvatar: string | null
  ownerIsTeam?: boolean
  description: string | null
  /** Unix seconds of the last update — "Updated N ago" reads as maintenance
   *  signal; a bare version number does not. */
  updatedAt?: number | null
  skillCount: number
  /** Private kit — a lock badge rides beside the title, like the skill page. */
  isPrivate?: boolean
  /** Member categories, in canonical order — drives the generative cover. */
  categories: (string | null)[]
  /** Optional cover override — the author-kit leads with the author's face
   *  instead of the generative kit cover. When omitted, PaintedCover renders. */
  coverNode?: ReactNode
  /** Drop the "Kit by @owner" byline — the author-kit's title already names the
   *  author, so the byline would just repeat it. */
  hideByline?: boolean
  /** The real primary CTA (Subscribe / Manage). */
  action?: ReactNode
  /** The follow-the-curator button, beside the primary CTA. */
  follow?: ReactNode
}) {
  // Capabilities/flags are NOT summarized in the header: the raw finding count
  // over-reads (dozens of per-file hits vs a handful of distinct types) and a
  // capability count can't be made to match the panel's chip partition without
  // duplicating its logic — a header number that disagrees with the panel below
  // erodes trust. The header carries scope; the PERMISSIONS panel (prominent,
  // right under the hero) owns the capability + flag detail, accurately.
  return (
    <div className="grid items-center gap-12 lg:grid-cols-[300px_minmax(0,1fr)]">
      <div className="mx-auto w-full max-w-[300px]">
        <div className="relative aspect-square w-full overflow-hidden rounded-2xl shadow-[0_14px_30px_-16px_rgba(40,30,15,0.4)] ring-1 ring-(--ink)/[0.04]">
          {coverNode ?? (
            // Route through the shared kit fallback so an empty (or all-
            // uncategorized) kit paints a real generative cover from its seed,
            // matching its cards, instead of PaintedCover rendering nothing.
            <PaintedCover
              seed={kitId}
              categories={kitCoverCategories(categories, null, categories.length, kitId)}
            />
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className={PAGE_EYEBROW_CLASS}>Kit</span>
          {isPrivate && <PrivateMark className="text-(--ink-2)" />}
        </div>
        <h1 className="text-4xl font-bold leading-[1.0] tracking-[-0.03em] sm:text-5xl">
          {name}
        </h1>
        {/* Tagline leads, right under the title (App Store / Spotify order) — the
            value prop before the who/when meta. */}
        {description?.trim() && (
          <p className="mt-3 max-w-[54ch] text-base leading-[1.55] text-(--ink-2)">
            {description}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-(--ink-2)">
          {!hideByline && (
            <>
              <PersonHoverName handle={owner}>
                <Link
                  href={`/${owner}`}
                  className="group inline-flex items-center gap-2 font-semibold text-(--ink)"
                >
                  {ownerAvatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={ownerAvatar} alt="" className="size-5.5 rounded-full object-cover" />
                  ) : (
                    <Avatar
                      name={owner}
                      colorKey={owner}
                      kind={ownerIsTeam ? 'team' : 'person'}
                      size="xs"
                      aria-hidden
                    />
                  )}
                  <span className="group-hover:underline">@{owner}</span>
                </Link>
              </PersonHoverName>
              <span aria-hidden="true">·</span>
            </>
          )}
          <span>
            <span className="font-semibold text-(--ink)">{fmt(skillCount)}</span>{' '}
            {skillCount === 1 ? 'skill' : 'skills'}
          </span>
          {updatedAt ? (
            <>
              <span aria-hidden="true">·</span>
              <span>Updated {timeAgo(updatedAt, { suffix: true })}</span>
            </>
          ) : null}
        </div>
        {(action || follow) && (
          <div className="mt-6 flex flex-wrap items-center gap-3">
            {action}
            {follow}
          </div>
        )}
      </div>
    </div>
  )
}
