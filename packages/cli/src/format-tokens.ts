/**
 * Compact, approximate token count for a row stat (e.g. `~1.3K`). The leading
 * tilde carries the approximation — the number is a cross-vendor estimate, never
 * an exact per-model count. Rules: uppercase `K` at/above 1000, one decimal
 * below 10K and none at/above (1320 → `~1.3K`, 47000 → `~47K`); below 1000, the
 * raw rounded integer (840 → `~840`). Mirrors the web helper `formatTokens` in
 * packages/web/src/lib/format.ts — duplicated per KTD7, do not import across
 * packages. Callers guard on presence: a 0/absent value renders nothing.
 */
export function formatTokens(n: number): string {
  const rounded = Math.round(n);
  if (rounded >= 1000) {
    const thousands = rounded / 1000;
    const label = thousands < 10 ? thousands.toFixed(1) : String(Math.round(thousands));
    return `~${label}K`;
  }
  return `~${rounded}`;
}
