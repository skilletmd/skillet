import { categoryCoverSvg } from '@skillet/protocol/covers'
import { PaintedCover } from '@/components/cover/painted-cover'
import type { CategoryKey } from '@/lib/categories'

/**
 * The single-skill cover. With a `seed` (the skill's ref) it paints the canvas
 * roll: a rounded tile in the category tint (the instant/SSR paint) with the
 * per-pixel monochrome gradation printed over it client-side, glyph knocked
 * out of the raster. Without a seed it stays the legacy squircle from the
 * shared SVG engine (which also remains the desktop/OG art).
 */
export function CategoryCover({
  category,
  seed,
  radius = 'rounded-xl',
  className = 'absolute inset-0',
}: {
  category: CategoryKey
  /** The skill's ref. Presence opts into the painted cover. */
  seed?: string
  /** Corner radius of the painted tile — matches KitStackIcon's convention so
   *  skill and kit marks share one silhouette in any given slot. */
  radius?: string
  /** Positioning/sizing for the root — it establishes the box the cover fills,
   *  so it must be positioned + sized (defaults to `absolute inset-0`). */
  className?: string
}) {
  if (seed) {
    return (
      <div className={className} aria-hidden="true">
        <div
          className={`absolute inset-0 overflow-hidden ${radius} ring-1 ring-inset ring-black/[0.06]`}
        >
          {/* PaintedCover carries its own theme-aware flat-tint + glyph fallback. */}
          <PaintedCover seed={seed} categories={[category]} />
        </div>
      </div>
    )
  }
  return (
    <div
      className={className}
      dangerouslySetInnerHTML={{ __html: categoryCoverSvg(category) }}
    />
  )
}
