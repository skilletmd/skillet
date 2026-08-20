// A green "▲ +18%" momentum pill. Up reads as the success color (the page is a
// growth story); a rare down step reads muted, never alarming-red — these are
// cumulative metrics, so "down" only means a slower month.

export function DeltaPill({
  pct,
  suffix = 'MoM',
}: {
  pct: number | null
  suffix?: string
}) {
  if (pct == null) return null
  const up = pct >= 0
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-pill px-1.5 py-0.5 text-xs font-semibold tabular-nums ${
        up ? 'bg-(--success-bg) text-(--success)' : 'bg-(--bg) text-(--ink-2)'
      }`}
    >
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      {Math.abs(pct).toFixed(0)}%
      {suffix && <span className="font-medium opacity-70">{suffix}</span>}
    </span>
  )
}
