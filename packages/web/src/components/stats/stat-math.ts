// Derived "momentum" numbers for the stats page — the rate-of-change figures a
// reader scans for (MoM %, growth multiple) rather than the raw totals. All
// computed from a cumulative monthly series, so the same series powers a card's
// sparkline and its delta pill.

/** Month-over-month growth of the last step, as a percentage. Null when there's
 *  no prior month or the prior value was zero (a jump from 0 isn't a "%"). */
export function momPct(series: number[]): number | null {
  if (series.length < 2) return null
  const prev = series[series.length - 2]
  const last = series[series.length - 1]
  if (prev <= 0) return null
  return ((last - prev) / prev) * 100
}

/** Total growth across the window as a multiple (last ÷ first non-zero month).
 *  Null when it didn't at least double-digit grow or the series is too short. */
export function growthMultiple(series: number[]): number | null {
  if (series.length < 2) return null
  const last = series[series.length - 1]
  const first = series.find((v) => v > 0)
  if (!first || last <= first) return null
  return last / first
}

export function formatMultiple(m: number): string {
  return m >= 10 ? `${Math.round(m)}×` : `${m.toFixed(1)}×`
}
