import Link from 'next/link'
import { UsedByProof } from '@/components/kits/used-by-live'
import { Avatar } from '@/components/ui/avatar'
import { Eyebrow } from '@/components/ui/eyebrow'
import type { UsedByFace } from '@/components/directory-card'

/**
 * One "used by" treatment across Skillet — the social-proof unit that pairs a
 * row of real faces with the live count line. It drives every surface: the
 * footer under skill/kit cards (homepage, directory, feed) as `inline`, and the
 * lead of skill/kit detail sidebars as `stacked`. Same faces, same count, same
 * wording everywhere.
 *
 * Faces are real users — public-kit curators for skills, subscribers for kits,
 * people you follow on feed cards — never fabricated.
 */
export function UsedBy({
  id,
  initial,
  faces,
  layout = 'inline',
  proof,
}: {
  /** Live-count key — a skill ref or a kit id. Omit for surfaces with no live
   *  count (e.g. virtual author-kits); pass `proof` for the static line instead. */
  id?: string
  initial: number
  faces: UsedByFace[]
  layout?: 'inline' | 'stacked'
  /** Static proof line used when there's no `id` to drive a live count. */
  proof?: string
  /** Accepted for call-site compatibility; the heading is always "Used by" now. */
  kind?: 'skill' | 'kit'
}) {
  // stacked — leads a detail-page sidebar: an eyebrow heading (matching the
  // rail's other sections), faces, then the wrapping proof line beneath.
  if (layout === 'stacked') {
    if (initial <= 0 && faces.length === 0) return null
    return (
      <section className="py-4 first:pt-0">
        <Eyebrow>Used by</Eyebrow>
        <div className="mt-2.5">
          <UsedByFacepile faces={faces} size="md" linkFaces />
          <p className={`text-sm text-(--ink-2) ${faces.length > 0 ? 'mt-1' : ''}`}>
            {id ? (
              <UsedByProof id={id} initial={initial} faces={faces} variant="block" />
            ) : (
              <span className="whitespace-normal opacity-80">{proof}</span>
            )}
          </p>
        </div>
      </section>
    )
  }

  // inline — the tight footer row under a card; the parent supplies the flex row.
  return (
    <>
      <UsedByFacepile faces={faces} size="sm" />
      {id ? (
        <UsedByProof id={id} initial={initial} faces={faces} />
      ) : (
        <span className="min-w-0 truncate opacity-80">{proof}</span>
      )}
    </>
  )
}

/**
 * Overlapping avatar row — the visual half of {@link UsedBy}. Exported as a
 * building block; most callers want the full {@link UsedBy} instead. Purely
 * presentational, so it stays a server component. Sizes mirror the card sizes:
 * `sm` is the tight card footer, `md` leads a detail sidebar. Renders nothing
 * when there are no real faces.
 */
export function UsedByFacepile({
  faces,
  size = 'sm',
  /** Wrap each face in a link to its profile. Off by default because the
   *  inline footer pile sits inside the card's own link (no nested links). */
  linkFaces = false,
}: {
  faces: UsedByFace[]
  size?: 'sm' | 'md'
  linkFaces?: boolean
}) {
  if (faces.length === 0) return null
  // Dedupe by handle — the same person can legitimately appear twice in the
  // upstream data (e.g. curator + subscriber), which would collide React keys
  // and drop a face. Keep first occurrence, preserve order.
  const seen = new Set<string>()
  const uniqueFaces = faces.filter((f) => (seen.has(f.handle) ? false : (seen.add(f.handle), true)))
  // Overlapping pile (both sizes) — reads as a classic facepile and packs more
  // faces into the same width; the ring matching the surface keeps each crisp.
  const cap = size === 'md' ? 7 : uniqueFaces.length
  return (
    <div className={size === 'md' ? 'flex -space-x-2' : 'flex -space-x-1.5'}>
      {uniqueFaces.slice(0, cap).map((f) => {
        const avatar = (
          <Avatar
            src={f.avatarUrl}
            name={f.name}
            colorKey={f.handle}
            size={size === 'md' ? 'sm' : 'xxs'}
            className={
              size === 'md' ? 'ring-2 ring-(--bg)' : 'h-5 w-5 ring-2 ring-(--card-pop)'
            }
            aria-hidden={!linkFaces}
          />
        )
        return linkFaces ? (
          <Link
            key={f.handle}
            href={`/${f.handle}`}
            aria-label={`@${f.handle}`}
            className="relative rounded-full transition hover:z-10 hover:-translate-y-0.5"
          >
            {avatar}
          </Link>
        ) : (
          <div key={f.handle}>{avatar}</div>
        )
      })}
    </div>
  )
}
