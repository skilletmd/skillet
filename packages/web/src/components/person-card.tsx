import Image from 'next/image'
import type { ReactNode } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { CardLg, CardMd, CardSm, type CardSize } from '@/components/card/shells'
import { resolveAvatar } from '@/lib/avatar-color'
import { isOptimizableImageHost } from '@/lib/image-hosts'

/**
 * The person card across all three tiers. `size` picks the shell; this maps a
 * person's data into it. lg is a featured tile (full-bleed avatar), md (default)
 * the browse/feed card, sm the rail row.
 */
export function PersonCard({
  size = 'md',
  handle,
  name,
  avatarUrl,
  stats,
  action,
  children,
  growChildren = false,
  footerBordered = false,
  flat = false,
  priority = false,
}: {
  size?: CardSize
  handle: string
  name: string
  avatarUrl?: string | null
  /** Quiet meta line (installs · followers · skills) on the md footer. */
  stats?: string[]
  /** Hairline above the stat footer — used on the person hover card. */
  footerBordered?: boolean
  /** Static surface (no press/lift) — used on the person hover card. */
  flat?: boolean
  /** Top-right action (e.g. a Follow button) — md. */
  action?: ReactNode
  /** Contextual content under @handle — category links or a top-skills peek (md). */
  children?: ReactNode
  /** Let the category-chip row wrap to a second line instead of clipping onto
   *  the stat footer (md). See {@link CardMd} growChildren. */
  growChildren?: boolean
  /** Mark the lg cover as the page's LCP image (first featured tile). */
  priority?: boolean
}) {
  if (size === 'sm') {
    return (
      <CardSm
        href={`/${handle}`}
        mark={
          <Avatar
            src={avatarUrl}
            name={name}
            colorKey={handle}
            size="md"
            className="h-9 w-9"
            aria-hidden="true"
          />
        }
        title={name}
        subtitle={`@${handle}`}
      />
    )
  }

  if (size === 'lg') {
    const cover = resolveAvatar(avatarUrl, handle)
    // photo → optimize when the host is allowlisted; faceUrl is a local SVG →
    // always unoptimized.
    const coverSrc = cover.photo ?? cover.faceUrl
    const coverUnoptimized = cover.photo ? !isOptimizableImageHost(cover.photo) : true
    return (
      <CardLg
        href={`/${handle}`}
        cover={
          <div
            className="absolute inset-0 overflow-hidden"
            style={{ background: cover.photo ? undefined : cover.background }}
          >
            {coverSrc && (
              <Image
                src={coverSrc}
                alt=""
                fill
                sizes="(max-width: 640px) 50vw, 280px"
                unoptimized={coverUnoptimized}
                priority={priority}
                className="object-cover"
                referrerPolicy="no-referrer"
              />
            )}
          </div>
        }
        title={name}
        subtitle={`@${handle}`}
      />
    )
  }

  return (
    <CardMd
      href={`/${handle}`}
      mark={
        <Avatar
          src={avatarUrl}
          name={name}
          colorKey={handle}
          size="md"
          className="h-full w-full"
          aria-hidden="true"
        />
      }
      title={name}
      subtitle={
        <span className="-mt-0.5 block truncate text-sm font-medium text-(--accent)">@{handle}</span>
      }
      action={action}
      growChildren={growChildren}
      footerBordered={footerBordered}
      flat={flat}
      footer={
        stats && stats.length > 0
          ? stats.map((s, i) => (
              <span key={s} className="inline-flex items-center gap-2 tabular-nums">
                {i > 0 && <span aria-hidden="true">·</span>}
                {s}
              </span>
            ))
          : undefined
      }
    >
      {children}
    </CardMd>
  )
}
