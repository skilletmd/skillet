'use client'

/**
 * The painted (canvas) cover as a React surface. `CoverCanvas` renders one
 * recipe at a given display size (backing canvas at size × dpr, so the
 * screen's cells are native device pixels at every size). `PaintedCover` is
 * the production wrapper: give it the cover seed + categories and it measures
 * its container, derives the recipe (skill roll or kit waves), and paints —
 * skills knock out their category glyph, kits their weighted section marks
 * (solo below SOLO_MARK_MAX).
 *
 * Client-only by nature (canvas). Callers keep the shared SVG engine
 * underneath as the SSR/no-JS layer; this fades in over it.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_GRAIN,
  PRESS_SEED,
  SOLO_MARK_MAX,
  glyphMask,
  glyphOptics,
  printPx,
  kitMarkMask,
  kitRecipe,
  renderRecipe,
  skillRecipe,
  type Recipe,
  type GlyphMode,
} from '@/lib/cover-canvas'
import { CATEGORY_BY_KEY, isCategoryKey, type CategoryKey } from '@/lib/categories'
import { CategoryIcon } from '@/components/category-icons'
import { useTheme } from '@/components/use-theme'

export function CoverCanvas({
  recipe,
  size,
  maskKey,
  getMask,
  misprint = false,
  glyphMode = 'knockout',
  className,
}: {
  recipe: Recipe
  /** Display size in CSS px; the backing canvas renders at size × dpr. */
  size: number
  /** Cache identity for the printed mark; null renders the bare ground. */
  maskKey: string | null
  getMask?: (px: number) => Promise<Uint8ClampedArray>
  misprint?: boolean
  /** How the glyph reads: paper knockout (default), deep-ink invert, or burn. */
  glyphMode?: GlyphMode
  className?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    let cancelled = false
    const px = printPx(size, window.devicePixelRatio || 1)
    const run = async (): Promise<void> => {
      const mask = maskKey && getMask ? await getMask(px) : null
      if (!cancelled && ref.current) renderRecipe(ref.current, recipe, mask, misprint, px, glyphMode)
    }
    void run()
    return () => {
      cancelled = true
    }
    // getMask identity is carried by maskKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipe, size, maskKey, misprint, glyphMode])
  return (
    <canvas
      ref={ref}
      // object-cover: the print is square; non-square containers crop it
      // instead of stretching the raster.
      className={className ?? 'absolute inset-0 h-full w-full object-cover'}
      aria-hidden="true"
    />
  )
}

/** True when PaintedCover will actually paint for these categories — callers can
 *  skip their own art layer (uncategorized singles stay on the SVG design). */
export function hasPaintedCover(categories: (string | null | undefined)[]): boolean {
  const valid = categories.filter((c) => isCategoryKey(c))
  return valid.length >= 1
}

/**
 * The production painted cover. Same inputs as the shared SVG engine's coverSvg:
 * a seed (the skill/kit ref) and the raw categories (one for a skill, the
 * members' for a kit, duplicates meaningful). Carries its own fallback — a
 * flat category tint, plus the centered glyph for skills — which the print
 * covers seamlessly once rendered (the glyph sits where the knockout lands).
 * Theme-aware: dark mode prints the dark pressing (dark sheet, dark
 * knockout). Renders nothing at all for uncategorized singles.
 */
export function PaintedCover({ seed, categories }: { seed: string; categories: (string | null | undefined)[] }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(0)
  // Visible height fraction of the square print under the container's
  // center crop (h/w for wide containers, 1 for square/tall) — the mask
  // anchors the edition stamp to the visible foot with it.
  const [visibleFrac, setVisibleFrac] = useState(1)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const theme = useTheme()
  const dark = mounted && theme === 'dark'

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const measure = (): void => {
      // The print is square; in non-square containers render at the larger
      // side and let object-cover center-crop.
      const rect = el.getBoundingClientRect()
      const s = Math.round(Math.max(rect.width, rect.height))
      if (s > 0) {
        setSize(s)
        setVisibleFrac(
          rect.width > rect.height && rect.width > 0
            ? Math.round((rect.height / rect.width) * 100) / 100
            : 1,
        )
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const valid = useMemo(
    () => categories.filter((c): c is CategoryKey => isCategoryKey(c)),
    [categories],
  )
  const isKit = categories.length > 1 && valid.length > 1

  const grain = useMemo(() => ({ ...DEFAULT_GRAIN, dark }), [dark])
  const recipe = useMemo(() => {
    if (isKit) return kitRecipe(seed, valid, PRESS_SEED, grain)
    if (valid.length === 1)
      return skillRecipe(CATEGORY_BY_KEY[valid[0]], PRESS_SEED, grain, 'system', seed)
    return null
  }, [seed, valid, isKit, grain])

  // Skills use two optical cuts (list vs display) — see glyphOptics.
  const optics = glyphOptics(size)
  const maskKey = recipe
    ? isKit
      ? `kit:${valid.join(',')}:${size < SOLO_MARK_MAX ? 'solo' : 'row'}:f${visibleFrac}:${dark ? 'd' : 'l'}`
      : `skill:${valid[0]}:${optics.frac}:${dark ? 'd' : 'l'}`
    : null

  // The flat fallback: category tint + (skills) the glyph, positioned where
  // the printed mark lands so the canvas swap doesn't jump.
  const cat = valid.length > 0 ? CATEGORY_BY_KEY[valid[0]] : null
  const tint = cat
    ? isKit
      ? dark
        ? `hsl(${cat.hue} 10% 12%)`
        : `hsl(${cat.hue} 16% 86%)`
      : dark
        ? `hsl(${cat.hue} 14% 12%)`
        : `hsl(${cat.hue} ${Math.round(cat.sat * 0.8)}% 84%)`
    : undefined
  // Burn: the glyph is the same-hue ground, pooled darker (an overprint), so the
  // pre-paint fallback deepens the tint instead of flashing the old cream cutout.
  const glyphCol = cat
    ? dark
      ? `hsl(${cat.hue} 16% 7%)`
      : `hsl(${cat.hue} ${Math.round(cat.sat)}% 58%)`
    : undefined

  return (
    <div ref={hostRef} className="absolute inset-0" aria-hidden="true">
      {recipe && (
        <>
          <div className="absolute inset-0" style={{ background: tint }}>
            {!isKit && cat && (
              <span
                className="absolute inset-0 grid place-items-center"
                style={{ color: glyphCol }}
              >
                <span
                  className="block"
                  style={{ height: `${optics.frac * 100}%`, width: `${optics.frac * 100}%` }}
                >
                  <CategoryIcon
                    cat={cat.key}
                    strokeWidth={optics.stroke}
                    className="h-full w-full"
                  />
                </span>
              </span>
            )}
          </div>
          {size > 0 && (
            <CoverCanvas
              recipe={recipe}
              size={size}
              maskKey={maskKey}
              getMask={(px) =>
                isKit
                  ? kitMarkMask(valid, px, size < SOLO_MARK_MAX, visibleFrac)
                  : glyphMask(valid[0], px, optics.frac, optics.stroke)
              }
              glyphMode="burn"
            />
          )}
        </>
      )}
    </div>
  )
}
