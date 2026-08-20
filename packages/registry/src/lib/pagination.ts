/**
 * Pagination input clamping. Offsets and limits arrive from untrusted query
 * strings and feed SQL LIMIT / OFFSET, so they must be bounded — an unclamped
 * offset (used as `offset + limit`) materializes an arbitrarily large result set.
 */

/** Default upper bound for a pagination offset across feed/discover/follows. */
export const MAX_PAGE_OFFSET = 10_000;

/** Parse and clamp an integer query param to [min, max], falling back to def. */
export function clampInt(
  raw: string | undefined,
  def: number,
  min: number,
  max: number,
): number {
  if (raw === undefined) return def;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(Math.max(n, min), max);
}
