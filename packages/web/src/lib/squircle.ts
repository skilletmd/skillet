import type { CSSProperties } from 'react'

/**
 * iOS-style squircle (continuous-curvature superellipse, |x|^n+|y|^n=1 with
 * n≈4.6) as a reusable clip — the shape we use for every *thing* (skill marks,
 * kit covers), while *people* stay circular. CSS `border-radius` only gives a
 * circular-arc corner; this is the real superellipse, so the corners read like a
 * crafted app icon instead of a rounded rectangle.
 *
 * Delivered as an SVG mask data-URI with `preserveAspectRatio="none"`, so the
 * path (authored in a 0–100 box) stretches to fill any element at any size —
 * no global <clipPath> def to mount, no per-size math.
 */
const SQUIRCLE_PATH =
  'M100 50 L99.9 68.21 L99.58 74.57 L99.05 79.2 L98.31 82.93 L97.34 86.05 L96.14 88.72 L94.7 91.02 L93.01 93.01 L91.02 94.7 L88.72 96.14 L86.05 97.34 L82.93 98.31 L79.2 99.05 L74.57 99.58 L68.21 99.9 L50 100 L31.79 99.9 L25.43 99.58 L20.8 99.05 L17.07 98.31 L13.95 97.34 L11.28 96.14 L8.98 94.7 L6.99 93.01 L5.3 91.02 L3.86 88.72 L2.66 86.05 L1.69 82.93 L0.95 79.2 L0.42 74.57 L0.1 68.21 L0 50 L0.1 31.79 L0.42 25.43 L0.95 20.8 L1.69 17.07 L2.66 13.95 L3.86 11.28 L5.3 8.98 L6.99 6.99 L8.98 5.3 L11.28 3.86 L13.95 2.66 L17.07 1.69 L20.8 0.95 L25.43 0.42 L31.79 0.1 L50 0 L68.21 0.1 L74.57 0.42 L79.2 0.95 L82.93 1.69 L86.05 2.66 L88.72 3.86 L91.02 5.3 L93.01 6.99 L94.7 8.98 L96.14 11.28 L97.34 13.95 L98.31 17.07 L99.05 20.8 L99.58 25.43 L99.9 31.79 L100 50 Z'

const SQUIRCLE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'><path d='${SQUIRCLE_PATH}' fill='%23000'/></svg>`

const MASK_URL = `url("data:image/svg+xml,${SQUIRCLE_SVG}")`

/** Inline style that clips an element to the squircle, scaled to its box. */
export const squircleStyle: CSSProperties = {
  maskImage: MASK_URL,
  WebkitMaskImage: MASK_URL,
  maskSize: '100% 100%',
  WebkitMaskSize: '100% 100%',
  maskRepeat: 'no-repeat',
  WebkitMaskRepeat: 'no-repeat',
}
