import Link from 'next/link'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { profileHref } from '@/lib/urls'
import { humanizeSlug } from '@/lib/humanize-slug'
import { formatShortDate } from '@/lib/feed-format'

/**
 * Public deprecation tombstone. Shown in place of a 404 when a non-manager opens
 * a skill its author has deprecated: it explains the skill is gone and carries
 * the author's sunset note, with no install path. The registry serves the data
 * endpoint as 410; this page renders at 200 but is marked `noindex` upstream so
 * it de-indexes. Public-safe by construction — it only ever receives the
 * message + timestamp, never private skill detail.
 */
export function SkillTombstone({
  author,
  slug,
  message,
  deprecatedAt,
}: {
  author: string
  slug: string
  message: string | null
  deprecatedAt: string | null
}) {
  const title = humanizeSlug(slug)
  return (
    <div className={PAGE_CONTAINER_CLASS}>
      <div className="mx-auto max-w-[52ch] py-20 text-center">
        <p className="text-sm font-medium tracking-wide text-(--ink-2) uppercase">Deprecated</p>
        <h1 className="mt-3 text-2xl font-semibold text-(--ink)">{title}</h1>
        <p className="mt-4 text-sm leading-[1.6] text-(--ink-2)">
          <Link href={profileHref(author)} className="text-(--accent) hover:underline">
            @{author}
          </Link>{' '}
          deprecated this skill{deprecatedAt ? ` on ${formatShortDate(deprecatedAt)}` : ''}. It&rsquo;s
          no longer available to install.
        </p>
        {message?.trim() && (
          <div className="mt-6 rounded-xl border border-(--line) bg-(--surface) px-4 py-3 text-left">
            <p className="text-sm leading-[1.6] text-(--ink)">{message}</p>
          </div>
        )}
        <p className="mt-8 text-sm text-(--ink-2)">
          <Link href={profileHref(author)} className="text-(--accent) hover:underline">
            See other skills by @{author}
          </Link>
        </p>
      </div>
    </div>
  )
}
