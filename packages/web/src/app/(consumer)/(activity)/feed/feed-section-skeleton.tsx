import Link from 'next/link'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Badge } from '@/components/ui/badge'
import { FeedSectionHeader } from './feed-section-header'

/**
 * Loading placeholder for the Notifications / Updates sections. Renders the real
 * section header (titles are static) over a few row skeletons so the center column
 * holds its height while content streams — without it the center collapses to ~0,
 * which shrinks the flex row and jolts the sticky left rail until data arrives.
 *
 * Each variant mirrors the ANATOMY of its real view so the skeleton-to-content
 * swap doesn't jump:
 *  - notifications → the `.feed-item` shell (round gutter glyph, an avatar facepile,
 *    a text line, optional chip, divider) like {@link NotificationRow}.
 *  - updates → the full `UpdatesList` chrome: header with the Auto-update control,
 *    a Pending / Update-all bar, then `UpdateCard`-shaped rows.
 *
 * For data-dependent chrome (the Auto-update On/Off value, the Update-all button)
 * we reserve the SPACE with a neutral shimmer rather than render a real value —
 * a placeholder pill can't lie about a setting that hasn't loaded, and the rows
 * below still land where they'll live. Keep these in step with those components;
 * a skeleton that drifts from its view is the bug this file exists to prevent.
 */

type Variant = 'notifications' | 'updates'

/** Mirrors NotificationRow: round glyph + facepile + line (+ chip on some rows). */
function NotificationRowSkeleton({ withChip }: { withChip: boolean }) {
  return (
    <li className="feed-item feed-item--slim !items-start animate-pulse">
      <span className="mt-0.5 h-8 w-8 shrink-0 rounded-full bg-(--line)" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          {/* facepile: overlapping circles, same size/overlap as PersonFacepile */}
          <span className="inline-flex -space-x-2">
            <span className="h-8 w-8 rounded-full bg-(--line) ring-2 ring-(--bg)" />
            <span className="h-8 w-8 rounded-full bg-(--line) ring-2 ring-(--bg)" />
            <span className="h-8 w-8 rounded-full bg-(--line) ring-2 ring-(--bg)" />
          </span>
          <span className="mt-1.5 h-3 w-7 shrink-0 rounded bg-(--line)" />
        </div>
        <span className="mt-2 block h-3.5 w-2/3 rounded bg-(--line)" />
        {withChip && <span className="mt-2 block h-9 w-36 rounded-lg bg-(--line)" />}
      </div>
    </li>
  )
}

/** Mirrors UpdateCard: square mark + title/meta lines + an action column. */
function UpdateRowSkeleton() {
  return (
    <li className="flex animate-pulse items-start gap-3 py-4">
      <span className="h-10 w-10 shrink-0 rounded-lg bg-(--line)" />
      <div className="min-w-0 flex-1 space-y-2">
        <span className="block h-4 w-1/2 rounded bg-(--line)" />
        <span className="block h-3 w-1/3 rounded bg-(--line)" />
        <span className="block h-3 w-24 rounded bg-(--line)/80" />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="h-9 w-14 rounded-md bg-(--line)/70" />
        <span className="h-9 w-20 rounded-md bg-(--line)" />
      </div>
    </li>
  )
}

export function FeedSectionSkeleton({
  title,
  description,
  rows = 4,
  variant = 'notifications',
}: {
  title: string
  description: string
  rows?: number
  variant?: Variant
}) {
  if (variant === 'updates') {
    return (
      <div className="space-y-8">
        <FeedSectionHeader
          title={title}
          description={description}
          actions={
            // The "Auto-update:" label and "Manage" link are static — render them
            // for real and shimmer ONLY the On/Off value, which is what loads.
            <div className="flex items-center gap-2 text-xs">
              <Badge variant="default" appearance="chip">
                Auto-update:
                <span className="inline-block h-3 w-6 animate-pulse rounded bg-(--line) align-middle" />
              </Badge>
              <Link href="/settings" className="font-medium text-(--accent) hover:underline">
                Manage
              </Link>
            </div>
          }
        />
        <section>
          <div className="flex items-center justify-between gap-3">
            {/* "Pending" is a static label; the Skip-all / Update-all buttons are conditional. */}
            <Eyebrow>Pending</Eyebrow>
            <div className="flex items-center gap-2">
              <span className="h-9 w-16 animate-pulse rounded-md bg-(--line)/70" />
              <span className="h-9 w-24 animate-pulse rounded-md bg-(--line)" />
            </div>
          </div>
          <ul
            aria-busy="true"
            aria-label="Loading updates"
            className="mt-1 divide-y divide-(--line)"
          >
            {Array.from({ length: rows }).map((_, i) => (
              <UpdateRowSkeleton key={i} />
            ))}
          </ul>
        </section>
      </div>
    )
  }

  return (
    <>
      <FeedSectionHeader title={title} description={description} />
      <ul aria-busy="true" aria-label={`Loading ${title.toLowerCase()}`} className="feed-list mt-6">
        {Array.from({ length: rows }).map((_, i) => (
          // Vary chip presence like the real mix (follows have none, adoptions show
          // a kit/skill chip) so the column height matches what loads in.
          <NotificationRowSkeleton key={i} withChip={i % 2 === 1} />
        ))}
      </ul>
    </>
  )
}
