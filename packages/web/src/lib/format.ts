// Display helpers shared across the public skill/author surfaces.

/**
 * Render a version label for display. Live registry versions arrive as a hash
 * slice or the sentinel "latest"; mock/detail data carries semver ("1.4.0") or
 * short tags ("v2"). Prefix "v" only for bare numeric versions so we never
 * render "vlatest" or a doubled "vv2".
 */
export function formatVersion(version: string): string {
  if (!version) return ''
  return /^\d/.test(version) ? `v${version}` : version
}

/**
 * Compact, approximate token count for a headline (e.g. `~1.3K tokens`). The
 * leading tilde carries the approximation — the number is a cross-vendor
 * estimate, never an exact per-model count. Rules: uppercase `K` at/above 1000,
 * one decimal below 10K and none at/above (1320 → `~1.3K`, 47000 → `~47K`);
 * below 1000, the raw rounded integer (840 → `~840`). Callers guard on presence:
 * a 0/absent value renders nothing (this helper still returns `~0`).
 */
export function formatTokens(n: number): string {
  const rounded = Math.round(n)
  if (rounded >= 1000) {
    const thousands = rounded / 1000
    const label = thousands < 10 ? thousands.toFixed(1) : String(Math.round(thousands))
    return `~${label}K`
  }
  return `~${rounded}`
}

/**
 * Pick the singular or plural form of a word for a count. Returns the word
 * only — callers render their own count — so a leading space stays the
 * caller's concern. Defaults the plural to `singular + 's'`; pass an explicit
 * plural for irregular words ("is"/"are").
 */
export function pluralize(n: number, singular: string, plural = singular + 's'): string {
  return n === 1 ? singular : plural
}
