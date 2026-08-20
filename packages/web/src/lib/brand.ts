/**
 * Shared brand assets. `MASCOT_MASK` paints the chef mascot SVG as a CSS mask so
 * it inherits `currentColor` (use with `bg-(--ink)` etc.) instead of shipping a
 * second colored copy of the logo.
 */
export const MASCOT_MASK = {
  WebkitMaskImage: 'url(/brand/skillet-mascot-logo.svg)',
  maskImage: 'url(/brand/skillet-mascot-logo.svg)',
  WebkitMaskRepeat: 'no-repeat',
  maskRepeat: 'no-repeat',
  WebkitMaskPosition: 'center',
  maskPosition: 'center',
  WebkitMaskSize: 'contain',
  maskSize: 'contain',
} as const
