import Link from 'next/link'
import { SkillIcon, type UsedByFace } from '@/components/directory-card'
import { CoverArt } from '@/components/cover/cover'
import { coverHue } from '@/components/cover/cover-hue'
import { SkillKitControl } from '@/components/kits/skill-kit-control'
import { PencilIcon } from '@/components/kits/add-coin'
import { PrivateMark } from '@/components/visibility-badge'
import { Avatar } from '@/components/ui/avatar'
import { UsedBy } from '@/components/kits/used-by'
import { CardLg, CardMd, CardSm, CardXs, type CardSize } from '@/components/card/shells'
import { CATEGORY_BY_KEY, isCategoryKey } from '@/lib/categories'
import { skillHref } from '@/lib/urls'
import { humanizeSlug } from '@/lib/humanize-slug'

export { humanizeSlug } from '@/lib/humanize-slug'

const numberFormat = new Intl.NumberFormat('en-US')

export interface SkillCardProps {
  /** lg = featured square, md = browse/feed card (default), sm = rail row. */
  size?: CardSize
  author: string
  slug: string
  /** Human title. Falls back to a humanized slug when omitted. */
  title?: string | null
  description?: string | null
  category?: string | null
  /** Installs — the social-proof count (md caption) / subtitle (sm). */
  installCount?: number
  visibility?: 'public' | 'private'
  /** Own-skill edit link. Shows an Edit button (md) when set. */
  editHref?: string
  /** Render the built-in add-to-kit control (md). Defaults to true. */
  addToKit?: boolean
  /** Drop the avatar + @author byline when the surrounding page IS the author. */
  hideAuthor?: boolean
  /** Override the detail link (defaults to /skills/author/slug). */
  href?: string
  /** Maker avatar for the md meta line. */
  makerAvatarUrl?: string | null
  /** People you follow who use this — Instagram-style proof (md). */
  usedByFaces?: UsedByFace[]
}

/**
 * The skill card across all three tiers. `size` picks the shell; this maps a
 * skill's data into it. Defaults to `md` (the browse/feed card).
 */
export function SkillCard(props: SkillCardProps) {
  const {
    size = 'md',
    author,
    slug,
    title,
    description,
    category,
    installCount,
    visibility,
    editHref,
    addToKit = true,
    hideAuthor = false,
    href,
    makerAvatarUrl,
    usedByFaces = [],
  } = props
  const detailHref = href ?? skillHref(author, slug)
  const displayTitle = title?.trim() ? title : humanizeSlug(slug)
  const ref = `${author}/${slug}`
  const cat = isCategoryKey(category) ? CATEGORY_BY_KEY[category] : null

  if (size === 'xs') {
    return (
      <CardXs
        href={detailHref}
        title={displayTitle}
        mark={
          <CoverArt
            seed={ref}
            categories={[category ?? null]}
            listMark
            className="absolute inset-0 h-full w-full"
          />
        }
      />
    )
  }

  if (size === 'sm') {
    // Only show real social proof; "New" repeated down a rail is noise, so a
    // zero/absent count just drops to the category alone.
    const installText =
      installCount && installCount > 0
        ? `Used by ${numberFormat.format(installCount)}`
        : undefined
    // Lead with the category so the rail says what kind of skill each is; the
    // install count trails it. Either alone is fine if the other is absent.
    const subtitle = [cat?.label, installText].filter(Boolean).join(' · ') || undefined
    return (
      <CardSm
        href={detailHref}
        mark={<SkillIcon seed={ref} category={category} radius="rounded-lg" />}
        title={displayTitle}
        subtitle={subtitle}
      />
    )
  }

  if (size === 'lg') {
    return (
      <CardLg
        href={detailHref}
        hue={coverHue([category ?? null], ref)}
        cover={
          <div className="absolute inset-0 overflow-hidden">
            <CoverArt
              seed={ref}
              categories={[category ?? null]}
              className="absolute inset-0 h-full w-full"
            />
          </div>
        }
        title={displayTitle}
        description={description}
        subtitle={
          <span className="flex items-center justify-between gap-2">
            <span className="truncate">@{author}</span>
            {installCount && installCount > 0 ? (
              <span className="shrink-0 tabular-nums">
                Used by {numberFormat.format(installCount)}
              </span>
            ) : null}
          </span>
        }
        badge={
          visibility === 'private' ? (
            <PrivateMark chrome className="absolute left-3 top-3" />
          ) : undefined
        }
      />
    )
  }

  // md — the browse/feed card. The "Used by" line is live (UsedByProof) so it
  // bumps when the skill is added to a kit.
  return (
    <CardMd
      href={detailHref}
      hue={coverHue([category ?? null], ref)}
      mark={<SkillIcon seed={ref} category={category} />}
      eyebrow={visibility === 'private' ? <PrivateMark className="text-(--ink-2)" /> : undefined}
      title={displayTitle}
      action={
        addToKit ? <SkillKitControl author={author} slug={slug} variant="compact" /> : undefined
      }
      footer={
        <>
          {cat && (
            <Link
              href={`/browse/${cat.key}`}
              className="relative z-[1] hover:text-(--ink) hover:underline underline-offset-2"
            >
              {cat.label}
            </Link>
          )}
          {cat && !hideAuthor && <span aria-hidden="true">·</span>}
          {!hideAuthor && (
            <Link
              href={`/${author}`}
              className="relative z-[1] inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap hover:text-(--ink) hover:underline underline-offset-2"
            >
              <Avatar
                src={makerAvatarUrl}
                name={author}
                colorKey={author}
                size="xxs"
                aria-hidden="true"
              />
              <span className="truncate">@{author}</span>
            </Link>
          )}
          {(cat || !hideAuthor) && <span aria-hidden="true">·</span>}
          {/* Text-only on cards: the row highlights the MAKER's face; the
              usage faces (which wrap-orphaned off their own text) belong to
              detail-page sidebars. */}
          <UsedBy id={ref} initial={installCount ?? 0} faces={[]} />
          {/* Owner utility lives in the utility strip: the header keeps one
              control and the title gets its width back. Edit is quiet but
              always discoverable (no hover dependency on touch). */}
          {editHref && (
            <Link
              href={editHref}
              className="relative z-[1] ml-auto inline-flex items-center gap-1 hover:text-(--ink) hover:underline underline-offset-2"
            >
              <PencilIcon />
              Edit
            </Link>
          )}
        </>
      }
    >
      {description ? (
        <p className="line-clamp-2 text-pretty text-sm leading-[1.5] text-(--ink-2)">
          {description}
        </p>
      ) : null}
    </CardMd>
  )
}
