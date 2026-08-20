/**
 * Compact relative time ("just now", "5m", "3h", "2d", "4mo", "1y") for activity
 * rows. Shared by the main feed and the profile Activity strip so they read the
 * same and can't drift apart.
 *
 * `opts.suffix` appends " ago" to the relative buckets ("3h ago") for surfaces
 * that read as a sentence (e.g. the proposed-changes header). "just now" is left
 * as-is in both modes. Default (no opts) is byte-identical to the bare-label
 * output the feed rows have always rendered.
 */
export function timeAgo(atSeconds: number, opts?: { suffix?: boolean }): string {
  const suffix = opts?.suffix ? ' ago' : ''
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - atSeconds)
  if (diff < 60) return 'just now'
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `${mins}m${suffix}`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h${suffix}`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d${suffix}`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo${suffix}`
  return `${Math.floor(months / 12)}y${suffix}`
}

/**
 * One short-date formatter ("Jun 25, 2026") for display dates across the app, so
 * the many local copies can't drift in format or locale. Normalizes its input at
 * the edge: a number under ~1e12 is treated as unix SECONDS (×1000), a number at
 * or above as milliseconds, and a string as an ISO/parseable date. The locale is
 * pinned to 'en-US' so server and client render the same string. Invalid, NaN,
 * or null input returns '' rather than throwing.
 */
export function formatShortDate(input: number | string | null | undefined): string {
  if (input === null || input === undefined || input === '') return ''
  let date: Date
  if (typeof input === 'number') {
    if (Number.isNaN(input)) return ''
    date = new Date(input < 1e12 ? input * 1000 : input)
  } else {
    date = new Date(input)
  }
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
