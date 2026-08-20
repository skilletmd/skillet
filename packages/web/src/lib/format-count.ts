/** Compact a count for social proof: 13 → "13", 6_728 → "6.7K", 2_100_000 → "2.1M". */
export function compactCount(n: number): string {
  if (n < 1000) return n.toLocaleString()
  if (n < 1_000_000) return `${(Math.round(n / 100) / 10).toString()}K`
  return `${(Math.round(n / 100_000) / 10).toString()}M`
}
