// Per-image panel hues for docs illustrations. Each image gets its own soft
// two-hue gradient (echoing the kit mesh covers), derived deterministically from
// a seed so it's unique per page but stable across reloads.

const PANEL_HUES = [
  '#2f6f8f', // teal (brand accent)
  '#6f9c3f', // green
  '#4a72b0', // blue
  '#7a5ea8', // violet
  '#c08a3e', // amber
  '#b56a72', // rose
  '#3f9c93', // cyan
]

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h
}

/** Two distinct soft hues for an image panel, stable per seed. */
export function panelHues(seed: string): { g1: string; g2: string } {
  const h = hash(seed)
  const n = PANEL_HUES.length
  const i = h % n
  const j = (i + 1 + ((h >> 3) % (n - 1))) % n // always != i
  return { g1: PANEL_HUES[i], g2: PANEL_HUES[j] }
}
