'use client'

import { swatchHsl, type Category, type CategorySection } from '@/lib/categories'
import { usePaletteByKey } from '@/components/palette-context'

// A polygon path with softly rounded corners (radius rr).
function roundPoly(pts: Array<[number, number]>, rr: number): string {
  const n = pts.length
  let d = ''
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const v1 = [p0[0] - p1[0], p0[1] - p1[1]]
    const v2 = [p2[0] - p1[0], p2[1] - p1[1]]
    const l1 = Math.hypot(v1[0], v1[1]) || 1
    const l2 = Math.hypot(v2[0], v2[1]) || 1
    const c = Math.min(rr, l1 / 2, l2 / 2)
    const a = [p1[0] + (v1[0] / l1) * c, p1[1] + (v1[1] / l1) * c]
    const b = [p1[0] + (v2[0] / l2) * c, p1[1] + (v2[1] / l2) * c]
    d +=
      i === 0
        ? `M ${a[0].toFixed(2)} ${a[1].toFixed(2)} `
        : `L ${a[0].toFixed(2)} ${a[1].toFixed(2)} `
    d += `Q ${p1[0]} ${p1[1]} ${b[0].toFixed(2)} ${b[1].toFixed(2)} `
  }
  return d + 'Z'
}
// a touch bigger than the square's bounding box so it reads the same optical weight
const TRI_PATH = roundPoly(
  [
    [6, 0.4],
    [11.5, 11.2],
    [0.5, 11.2],
  ],
  1.9,
)

/**
 * A category bullet: the SHAPE encodes its section (square = Code, triangle =
 * Grow, circle = Create — the same key the cover art uses) and the FILL is the
 * category's colour. So the mark does double duty without a separate legend.
 * Shared by the browse rail, the category chips, and anywhere a category needs
 * its recognizable mark.
 */
/**
 * The section's shape as an OUTLINE (no fill) in the current text color. A
 * section spans many category colors, so its header mark carries the shared
 * silhouette — square = Code, circle = Create, triangle = Grow — without
 * committing to any one category's hue. Same shape key as {@link CategoryMark}.
 */
export function SectionMark({
  section,
  size = 10,
  className = '',
}: {
  section: CategorySection
  size?: number
  className?: string
}) {
  return (
    // SOLID, matching the marks the kit covers print — the chrome and the art
    // must speak one vocabulary (the outline variant read as a different
    // symbol). Slightly smaller radii than CategoryMark so the filled shapes
    // sit level with uppercase section labels.
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden="true"
      className={`-translate-y-px shrink-0 ${className}`}
      fill="currentColor"
    >
      {section === 'Create' ? (
        <circle cx="6" cy="6" r="4.9" />
      ) : section === 'Grow' ? (
        <path d={TRI_PATH} />
      ) : (
        <rect x="1.4" y="1.4" width="9.2" height="9.2" rx="2.4" />
      )}
    </svg>
  )
}

export function CategoryMark({ cat, size = 10 }: { cat: Category; size?: number }) {
  // Live palette override (dev switcher); falls back to the cat's baked color.
  const live = usePaletteByKey()
  const col = swatchHsl(live?.[cat.key] ?? cat)
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className="shrink-0">
      {cat.section === 'Create' ? (
        <circle cx="6" cy="6" r="5" fill={col} />
      ) : cat.section === 'Grow' ? (
        <path d={TRI_PATH} fill={col} />
      ) : (
        <rect x="1" y="1" width="10" height="10" rx="2.6" fill={col} />
      )}
    </svg>
  )
}
