import { CATEGORY_BY_KEY, isCategoryKey, type CategoryKey } from '@/lib/categories'
// Subpath import, not the barrel: the barrel pulls node:crypto and blanks the page.
import { isUncategorizedSingle, UNCATEGORIZED_HUE } from '@skillet/protocol/covers'

/**
 * The dominant hue a {@link CoverArt} paints for these categories + seed, so a page
 * can tint its hero wash to match the cover. A genuinely-uncategorized single
 * skill gets the neutral hue (matching the engine's neutral ground); everything
 * else takes its first valid category, or a deterministic seed fallback.
 *
 * Pure and server-safe (no React), so server components can call it during render
 * — deliberately kept out of the client-only CoverArt module (./cover).
 */

function fnv(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0
  return h >>> 0
}

export function coverHue(categories: (string | null | undefined)[], seed: string): number {
  if (isUncategorizedSingle(categories)) return UNCATEGORIZED_HUE
  const valid = categories.filter(isCategoryKey)
  const keys = Object.keys(CATEGORY_BY_KEY) as CategoryKey[]
  const first = valid[0] ?? keys[fnv(seed) % keys.length]
  return CATEGORY_BY_KEY[first].hue
}
