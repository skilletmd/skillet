import { CATEGORY_BY_KEY, isCategoryKey, type CategoryKey } from '@/lib/categories'

/**
 * The dominant cover hue for an OG card. satori can't render the React cover
 * components, and the painted cover is rasterized separately (see painted-cover.ts),
 * so all this side needs is the seed's dominant category hue to tint the whole card
 * in the skill/kit's own color — matching coverHue() on the page.
 */

function fnv(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0
  return h >>> 0
}

// resolveCats() from the shared engine — normalize to valid keys with a seeded
// fallback so the hue is never undefined.
function resolveCats(categories: (string | null | undefined)[], seed: string): CategoryKey[] {
  const valid = categories.filter(isCategoryKey).slice(0, 6)
  if (valid.length > 0) return valid
  const keys = Object.keys(CATEGORY_BY_KEY) as CategoryKey[]
  return [keys[fnv(seed) % keys.length]]
}

/** The dominant category hue a cover paints for this seed + categories — used to
 *  tint the whole card in the skill/kit's own color (matches coverHue() on the
 *  page side). */
export function coverHue(seed: string, categories: (string | null | undefined)[]): number {
  const sk = resolveCats(categories, seed)
  const counts = new Map<CategoryKey, number>()
  for (const k of sk) counts.set(k, (counts.get(k) ?? 0) + 1)
  const dom =
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? sk[0]
  return CATEGORY_BY_KEY[dom].hue
}
