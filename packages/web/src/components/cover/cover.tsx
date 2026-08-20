'use client'

import { useEffect, useState } from 'react'
import { coverSvg } from '@skillet/protocol/covers'
import { useTheme } from '@/components/use-theme'
import { PaintedCover, hasPaintedCover } from '@/components/cover/painted-cover'

/**
 * The kit/skill cover — the one component every surface (cards, directory, single
 * skills, kit heroes, avatars) renders. Two layers from one seed:
 *
 *   1. the instant SVG from the shared engine (`@skillet/protocol/covers`, shared
 *      with the desktop): a categorized skill's app icon, an uncategorized skill's
 *      neutral ground, or a kit's flat tinted ground — plus the web-only paper grain;
 *   2. for categorized skills and kits, the richer painted canvas cover on top
 *      (see PaintedCover), which is the art you actually see.
 *
 * When the painted cover applies, the instant SVG is skipped (it would only flash
 * a plain tint before the canvas paints); the SVG still renders uncategorized
 * singles, single-skill app icons, and avatar/kit grounds. Change the art in the
 * shared engine and every surface — web and desktop — updates.
 *
 * Theme is a client-only signal: the server (and the first client render) paint
 * the static light palette; the effect then swaps in dark. Both render the same
 * (light) SVG first, so hydration matches; the dark swap is a normal post-mount
 * update. For the page tint hue, see coverHue in ./cover-hue.
 */
export function CoverArt({
  seed,
  categories,
  className,
  groundOnly = false,
  listMark = false,
}: {
  seed: string
  /** Raw categories — the shared engine resolves them (valid keys, kit fallback,
   *  or the neutral uncategorized-single render). */
  categories: (string | null | undefined)[]
  className?: string
  /** Render only the tinted ground, no glyph — e.g. behind an avatar. */
  groundOnly?: boolean
  /** List/thumbnail surfaces: neutral placeholder when uncategorized. */
  listMark?: boolean
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const theme = useTheme()
  const dark = mounted && theme === 'dark'
  const painted = !groundOnly && hasPaintedCover(categories)
  const svg = painted ? null : coverSvg(seed, categories, { dark, groundOnly, listMark })

  return (
    <div
      className={className}
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
      aria-hidden="true"
    >
      {svg && (
        <>
          <div
            className="absolute inset-0"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
          {/* web-only paper grain (soft-light) over the shared art */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: 'url(/brand/grain.png)',
              backgroundSize: '40px 40px',
              opacity: 0.45,
              mixBlendMode: 'soft-light',
              pointerEvents: 'none',
            }}
          />
        </>
      )}
      {painted && <PaintedCover seed={seed} categories={categories} />}
    </div>
  )
}
