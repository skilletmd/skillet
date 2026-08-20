import type { CSSProperties } from 'react'

/**
 * One source of truth for how cards look across the app — Browse, the home and
 * profile grids, the feed, and the Create page all read these. Flipping the
 * whole app between the flat and elevated looks is the two assignment lines at
 * the bottom; nothing else changes.
 *
 * These are *treatment only* — border / fill / shadow / hover. Each card keeps
 * its own layout (flex, radius, padding), so it composes as:
 *   `group … rounded-2xl ${CARD_TREATMENT} p-5`
 *
 * FLAT (active): Anthropic-style — a hairline border on a warm-white fill; on
 * hover the hairline deepens a step and a soft shadow appears (quiet, no black
 * border, no lift). SHADOW: borderless, soft drop shadow, hover-lift
 * (Linear/Vercel feel). To switch back, point CARD_TREATMENT at the SHADOW
 * variants below.
 */
/**
 * The shared interaction physics, kept apart from the color treatment so every
 * card (flat, featured, cover-tinted) moves identically. Response over decoration
 * (WWDC "Designing Fluid Interfaces"): a spring-settle curve (critically damped,
 * no bounce — the app's register is quiet), a 2px hover lift, and an instant
 * press — fast in (75ms), gentle out — so the card reacts on touch-down, not
 * release. Transforms are gated behind `motion-safe` so reduced-motion users get
 * the color change with none of the movement.
 *
 * The press is scoped: `:active` bubbles, so without the `:not(:has(…))` guards
 * pressing a nested control (the Add button, a footer link) would sink the whole
 * card — which reads as "you also triggered navigation". Nested controls swallow
 * their own press; the card presses only when the press lands on the card
 * itself, i.e. its stretched link (marked `card-main-link`, exempt from the
 * anchor guard).
 */
export const CARD_MOTION =
  'transition-[border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-safe:will-change-transform motion-safe:hover:-translate-y-0.5 motion-safe:[&:active:not(:has(button:active)):not(:has(a:active:not(.card-main-link)))]:scale-[0.985] motion-safe:active:duration-75'

export const CARD_TREATMENT_FLAT = `border border-(--line) bg-(--card-pop) ${CARD_MOTION} hover:border-(--ink)/25 hover:shadow-(--shadow-sm)`
export const CARD_TREATMENT_SHADOW =
  'bg-(--card-pop) shadow-(--shadow-sm) transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-(--shadow-md)'

/** The featured / "recommended" card: same treatment, tinted instead of white. */
export const CARD_TREATMENT_FEATURED_FLAT = `border border-(--accent)/30 bg-(--accent-bg) ${CARD_MOTION} hover:border-(--accent)/50 hover:shadow-(--shadow-sm)`
export const CARD_TREATMENT_FEATURED_SHADOW =
  'bg-(--accent-bg) shadow-(--shadow-sm) transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-(--shadow-md)'

/**
 * A non-interactive container surface: the card's resting look (border + fill)
 * with NO {@link CARD_MOTION} and no hover reaction. For panels that merely
 * share the card *surface* but aren't themselves a button — e.g. the Create
 * page's "Import from GitHub" card, which holds an input + its own buttons.
 * Using CARD_TREATMENT there would give the panel a press-down / hover-lift and
 * read as "the whole card is clickable", which it isn't.
 */
export const CARD_STATIC_FLAT = 'border border-(--line) bg-(--card-pop)'
export const CARD_STATIC_SHADOW = 'bg-(--card-pop) shadow-(--shadow-sm)'

// ── The active look. Flip these lines to switch the whole app. ──
export const CARD_TREATMENT = CARD_TREATMENT_FLAT
export const CARD_TREATMENT_FEATURED = CARD_TREATMENT_FEATURED_FLAT
export const CARD_STATIC = CARD_STATIC_FLAT

/**
 * A drop shadow that carries a cover hue but stays a *shadow*: held dark (low
 * lightness) and desaturated so it grounds the card instead of glowing under it.
 * Two levels drive the rest → raised lift. Single source so the featured tile
 * (resting-value tint on hover) and the list surfaces (browse card, kit row)
 * never drift apart.
 */
export function hueShadow(hue: number, level: 'rest' | 'raised'): string {
  const shade = (alpha: number) => `hsl(${hue} 40% 20% / ${alpha})`
  return level === 'raised'
    ? `0 2px 6px ${shade(0.12)}, 0 12px 28px ${shade(0.2)}`
    : `0 1px 2px ${shade(0.1)}, 0 5px 14px ${shade(0.15)}`
}

/**
 * Hover-only cover-hue vars for the list surfaces — a saturated border plus a
 * soft hue shadow. Apply with `hover:border-(--card-hover-border)
 * hover:shadow-(--card-shadow)` on top of {@link CARD_MOTION}. At rest the card
 * stays a neutral hairline so a wall of them doesn't read as noise.
 */
export function cardHoverVars(hue: number): CSSProperties {
  return {
    '--card-hover-border': `color-mix(in oklab, hsl(${hue} 60% 52%) 45%, var(--line))`,
    '--card-shadow': hueShadow(hue, 'rest'),
  } as CSSProperties
}
