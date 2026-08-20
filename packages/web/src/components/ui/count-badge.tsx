/**
 * Accent circular count chip — white tabular-nums text on the accent fill.
 * Renders nothing when `value <= 0`. Caps the display at `{max}+` (default 9).
 * The canonical look is promoted from the feed left-rail section nav; the bell
 * passes its absolute-overlay positioning via `className`.
 */
export function CountBadge({
  value,
  max = 9,
  className = 'ml-auto',
}: {
  value: number
  max?: number
  className?: string
}) {
  if (value <= 0) return null
  return (
    <span
      // The fill is themed but the text was a hardcoded white: --accent is
      // near-black in light mode and light cream in dark, so the count washed
      // out against its own pill in dark mode. --surface is the accent's
      // counterpart in both themes (same pairing as finish-setup-pill).
      className={`inline-flex min-w-[18px] items-center justify-center rounded-full bg-(--accent) px-1.5 py-px text-xs font-semibold leading-none text-(--surface) tabular-nums ${className}`}
    >
      {value > max ? `${max}+` : String(value)}
    </span>
  )
}
