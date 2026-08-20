import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CoverArt } from '@/components/cover/cover'
import { coverHue } from '@/components/cover/cover-hue'
import { KitStackIcon, kitCoverCategories } from '@/components/directory-card'
import { Avatar } from '@/components/ui/avatar'
import { PrivateMark } from '@/components/visibility-badge'
import { PencilIcon } from '@/components/kits/add-coin'
import { KitSubCount } from '@/components/kits/used-by-live'
import { UsedBy } from '@/components/kits/used-by'
import { compactCount } from '@/lib/format-count'
import { CardLg, CardMd, CardSm, CardXs, type CardSize } from '@/components/card/shells'
import { CATEGORY_BY_KEY, isCategoryKey } from '@/lib/categories'
import { CategoryMark } from '@/components/category-mark'
import { avatarColor, resolveAvatar } from '@/lib/avatar-color'
import { isOptimizableImageHost } from '@/lib/image-hosts'
import type { UsedByFace } from '@/components/directory-card'

const numberFormat = new Intl.NumberFormat('en-US')
function plural(n: number, one: string, many: string) {
  return `${numberFormat.format(n)} ${n === 1 ? one : many}`
}

/** A kit with no blurb describes itself by its contents — the member skill
 *  names (humanized from their ref slugs), like a playlist listing tracks.
 *  The card's two-line clamp truncates long kits naturally. */
function skillListFallback(refs: string[]): string | null {
  if (!refs.length) return null
  const names = refs
    .map((r) => {
      const slug = r.split('/').pop() ?? r
      return slug.replace(/-/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase())
    })
    .join(', ')
  return `Includes ${names}`
}

export interface KitCardProps {
  /** lg = featured square (default), md = browse card, sm = rail row. */
  size?: CardSize
  href: string
  /** Kit id — enables the live (optimistic) subscriber count on the lg tile. */
  kitId?: string
  name: string
  owner: string
  skillCount: number
  /** Owner-only count of unpublished skills. Author kits carry what
   *  subscribers get, so private work is counted separately, never folded in. */
  privateCount?: number
  /** Shown in the subtitle when > 0. */
  subscriberCount?: number
  /** Skill refs powering the cover, and their categories (for the blended hues). */
  skillRefs?: string[]
  skillCategories?: (string | null)[]
  /** Plurality category — drives the cover glyph (lg) and the meta dot (md). */
  category?: string | null
  /** Author-kit mode (lg): a round avatar instead of the mosaic — a person. */
  avatar?: { url: string | null; initial: string }
  visibility?: 'public' | 'private'
  /** Custom badge text that overrides the visibility icon (e.g. 'team'). */
  badge?: string
  /** Corner action coin (Add / Edit) — lg and the rest of the system. */
  menu?: ReactNode
  /** Drop the @owner byline when the surrounding page IS the owner. */
  hideOwner?: boolean
  /** Owner's edit affordance — quiet subtitle link, replacing the corner coin. */
  editHref?: string
  // md-only content:
  description?: string | null
  makerAvatarUrl?: string | null
  usedByFaces?: UsedByFace[]
  /** md action slot (Subscribe / Manage button). */
  action?: ReactNode
}

/** The kit's cover seed — the kit id when available so the cover matches the
 *  detail-page hero; without an id we fall back to the member refs, then the
 *  owner/name pair. */
function kitSeed(skillRefs: string[], seedBase: string, kitId?: string) {
  return kitId || skillRefs.join(',') || seedBase
}

/**
 * The generative kit cover (or an avatar for author-kits). Shared by the featured
 * lg tile and the kit detail-page hero — the kit's skills become a composition of
 * family shapes on a soft ground (see {@link CoverArt}).
 */
export function KitCoverStack({
  seed,
  category,
  avatar,
  owner,
  skillCategories,
  centerAvatar = false,
  bare = false,
}: {
  seed: string
  category?: string | null
  avatar?: { url: string | null; initial: string }
  owner: string
  /** Per-skill categories — drive the composition. */
  skillCategories?: (string | null)[]
  /** Center the avatar instead of lifting it for an overlaid title — use on
   *  covers that show the title beside the art (the author-kit hero), not over it
   *  (the featured CardLg tiles). */
  centerAvatar?: boolean
  /** Flush fill: no self-rounding or ring — the parent (a CardLg cover well) owns
   *  the corners, and the cover meets the card's text well with a straight edge. */
  bare?: boolean
}) {
  // kitCoverCategories synthesizes a deterministic seed spread when the kit has no
  // valid category (empty or all-uncategorized), so every kit — including a
  // 0-skill one — paints a real generative cover rather than a blank ground.
  const cats = kitCoverCategories(
    skillCategories ?? [],
    category,
    skillCategories?.length ?? 0,
    seed,
  )
  return (
    <div className={`absolute inset-0 overflow-hidden ${bare ? '' : 'rounded-2xl'}`}>
      <CoverArt
        seed={seed}
        categories={cats}
        // Ground-only behind an avatar: the face hides the art, so the painted
        // layer is wasted there. Every other kit gets the full generative cover.
        groundOnly={!!avatar}
        className="absolute inset-0 h-full w-full"
      />
      {!bare && (
        <span className="pointer-events-none absolute inset-0 z-10 rounded-2xl ring-1 ring-inset ring-black/[0.1]" />
      )}
      {avatar &&
        (() => {
          // Route through the shared avatar decision so the cover matches the
          // profile/feed: uploaded photo → illustrated default face → initials.
          const { photo, faceUrl, background } = resolveAvatar(avatar.url, owner, 'person')
          const src = photo ?? faceUrl
          // Full-bleed the author's face as the whole cover — a portrait poster,
          // not a small floating circle. `object-top` biases the crop to keep the
          // head/face when a square avatar meets the wider cover well. Initials
          // (no image) fill the ground with one large letter.
          if (!src) {
            return (
              <div
                className="absolute inset-0 flex items-center justify-center"
                style={{ background }}
              >
                <span className="text-5xl font-bold uppercase text-white">{avatar.initial}</span>
              </div>
            )
          }
          return (
            <div className="absolute inset-0" style={{ background: photo ? avatarColor(owner) : background }}>
              <Image
                src={src}
                alt=""
                fill
                sizes="320px"
                unoptimized={photo ? !isOptimizableImageHost(photo) : true}
                className="object-cover object-top"
                referrerPolicy="no-referrer"
              />
            </div>
          )
        })()}
    </div>
  )
}

/**
 * A compact kit row for sidebar lists ("People also added"): a 48px cover that
 * matches the page's skill rows, the kit name, and the owner with their avatar.
 * No skill count — the row leads with who, not how many. Renders an `<li>`.
 */
export function KitRow({
  href,
  kitId,
  name,
  owner,
  avatarUrl,
  skillRefs = [],
  skillCategories = [],
  category,
}: {
  href: string
  kitId?: string
  name: string
  owner: string
  /** The owner's avatar photo, if known — shown in the @owner line. */
  avatarUrl?: string | null
  skillRefs?: string[]
  skillCategories?: (string | null)[]
  category?: string | null
}) {
  const seed = kitSeed(skillRefs, `${owner}/${name}`, kitId)
  const coverCats = kitCoverCategories(
    skillCategories,
    category,
    Math.max(skillRefs.length, skillCategories.length, 2),
    seed,
  )
  return (
    <li>
      <Link
        href={href}
        // Borderless row: content aligns to the column edge (matching the section
        // labels) while the hover highlight bleeds outward via -mx/px so it keeps
        // its breathing room. The standard sidebar-list pattern.
        className="group -mx-3 flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-(--accent-bg)"
      >
        <span className="relative h-9 w-9 shrink-0">
          <KitStackIcon seed={seed} categories={coverCats} radius="rounded-lg" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-(--ink) group-hover:text-(--accent)">
            {name}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <Avatar
              src={avatarUrl}
              name={owner}
              colorKey={owner}
              kind="person"
              size="xxs"
              aria-hidden="true"
            />
            <span className="truncate font-mono text-xs text-(--ink-2)">@{owner}</span>
          </span>
        </span>
      </Link>
    </li>
  )
}

/**
 * The kit card across all three tiers. `size` picks the shell; this maps a kit's
 * data into it. Defaults to `lg` (the featured square), so existing featured
 * call sites need no change.
 */
export function KitCard(props: KitCardProps) {
  const {
    size = 'lg',
    href,
    kitId,
    name,
    owner,
    skillCount,
    privateCount,
    subscriberCount = 0,
    skillRefs = [],
    skillCategories = [],
    category,
    avatar,
    visibility,
    badge,
    menu,
    description,
    makerAvatarUrl,
    usedByFaces = [],
    action,
    hideOwner = false,
    editHref,
  } = props
  const cat = isCategoryKey(category) ? CATEGORY_BY_KEY[category] : null
  const seed = kitSeed(skillRefs, `${owner}/${name}`, kitId)
  const coverCats = kitCoverCategories(
    skillCategories,
    category,
    Math.max(skillCount, skillRefs.length),
    seed,
  )
  // An author kit shows what subscribers receive, which is published skills
  // only. Reporting "0 skills" to an owner who just uploaded a private one reads
  // as a lost upload, so name both rather than folding private into the total.
  const countLabel = privateCount
    ? `${skillCount} published · ${privateCount} private`
    : plural(skillCount, 'skill', 'skills')
  // Every kit (even a 0-skill one) gets a generative cover — coverCats carries a
  // seed fallback when there are no real categories.
  const stackIcon = <KitStackIcon seed={seed} categories={coverCats} />
  const coverTintHue = avatar ? null : coverHue(coverCats, seed)

  if (size === 'xs') {
    return (
      <CardXs
        href={href}
        title={name}
        mark={
          <CoverArt
            seed={seed}
            categories={coverCats}
            className="absolute inset-0 h-full w-full"
          />
        }
      />
    )
  }

  if (size === 'sm') {
    return (
      <CardSm
        href={href}
        // Smaller cover → smaller radius, so the corner reads proportional to the
        // larger covers instead of over-rounded.
        mark={<KitStackIcon seed={seed} categories={coverCats} radius="rounded-lg" />}
        title={name}
        subtitle={`@${owner}`}
        trailing={countLabel}
      />
    )
  }

  if (size === 'md') {
    return (
      <CardMd
        href={href}
        hue={coverTintHue}
        mark={stackIcon}
        title={name}
        action={action}
        // Same one-row meta as skill cards: category · maker (with face) ·
        // size · usage. No subtitle zone, no divider band.
        footer={
          <>
            {cat && (
              <Link href={`/browse/${cat.key}`} className="relative z-[1] hover:text-(--ink) hover:underline underline-offset-2">
                {cat.label}
              </Link>
            )}
            {cat && <span aria-hidden="true">·</span>}
            <Link
              href={`/${owner}`}
              className="relative z-[1] inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap hover:text-(--ink) hover:underline underline-offset-2"
            >
              <Avatar
                src={makerAvatarUrl ?? avatar?.url}
                name={owner}
                colorKey={owner}
                size="xxs"
                aria-hidden="true"
              />
              <span className="truncate">@{owner}</span>
            </Link>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{countLabel}</span>
            <span aria-hidden="true">·</span>
            <UsedBy id={kitId} initial={subscriberCount} faces={[]} />
          </>
        }
      >
        {(() => {
          const blurb = description || skillListFallback(skillRefs)
          return blurb ? (
            <p className="line-clamp-2 text-pretty text-sm leading-[1.5] text-(--ink-2)">
              {blurb}
            </p>
          ) : null
        })()}
      </CardMd>
    )
  }

  // lg — the featured square.
  const subtitle = (
    <span className="flex items-center justify-between gap-2">
      {hideOwner ? (
        // The byline is the page (own-profile grids): carry the skill count
        // instead — the fact a visitor actually wants from a kit tile.
        <span className="min-w-0 truncate">{countLabel}</span>
      ) : (
        // Above the card's stretched title link (relative z-[1]) so the byline
        // routes to the author, not the kit.
        <Link
          href={`/${owner}`}
          className="relative z-[1] flex min-w-0 items-center gap-1.5 hover:text-(--ink) hover:underline underline-offset-2"
        >
          <Avatar
            src={makerAvatarUrl ?? avatar?.url}
            name={owner}
            colorKey={owner}
            size="xxs"
            aria-hidden="true"
          />
          <span className="truncate">@{owner}</span>
        </Link>
      )}
      {/* Skill count lives in the cover composition, so the footer carries only
          the "added" count. */}
      <span className="flex shrink-0 items-center gap-2.5 tabular-nums">
        {/* Wrap the count so "Used by 38" is ONE flex item — otherwise the gap-2.5
            wedges between the "Used by" text and the number. */}
        {kitId ? (
          <span>
            <KitSubCount id={kitId} initial={subscriberCount} lead={false} />
          </span>
        ) : subscriberCount > 0 ? (
          <span>Used by {compactCount(subscriberCount)}</span>
        ) : null}
        {editHref && (
          <Link
            href={editHref}
            className="relative z-[1] inline-flex items-center gap-1 transition-colors hover:text-(--ink) hover:underline underline-offset-2"
          >
            <PencilIcon />
            Edit
          </Link>
        )}
      </span>
    </span>
  )
  // Public is the default — no marker. Only private gets a lock + "private" pill,
  // pinned top-left (clear of the top-right edit/add menu). Team kits carry no
  // pill — the profile context already says whose kit it is.
  const isPrivate = badge === 'private' || (!badge && visibility === 'private')
  const badgeNode = isPrivate ? (
    <PrivateMark chrome className="absolute left-3 top-3" />
  ) : null
  return (
    <CardLg
      href={href}
      hue={coverTintHue}
      cover={
        <KitCoverStack
          seed={seed}
          category={category}
          avatar={avatar}
          owner={owner}
          skillCategories={skillCategories}
          bare
        />
      }
      title={name}
      description={description || skillListFallback(skillRefs)}
      subtitle={subtitle}
      badge={badgeNode}
      menu={editHref ? undefined : menu}
    />
  )
}
