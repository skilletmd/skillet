import { Badge } from '@/components/ui/badge'

/** Globe (public) / lock (private) icon + badge, used on kits and skills. */
function GlobeIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3" />
      <path
        d="M2.2 8h11.6M8 2c1.7 1.8 1.7 10.2 0 12M8 2c-1.7 1.8-1.7 10.2 0 12"
        stroke="currentColor"
        strokeWidth="1.3"
      />
    </svg>
  )
}

export function LockIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="6.3" rx="1.3" stroke="currentColor" strokeWidth="1.3" />
      <path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/**
 * The private-only visibility marker. Public is the default and gets nothing.
 *
 * Two renderings, one vocabulary (lock + "private", mono caps):
 * - bare (default): inline text contexts — eyebrows, rows. Color from caller.
 * - chrome: floating over COVER ART. State never prints on the ink — it rides
 *   above it as chrome, the same language as the card's corner controls.
 */
export function PrivateMark({
  className = '',
  chrome = false,
}: {
  className?: string
  chrome?: boolean
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono text-xs uppercase tracking-[0.06em] ${
        chrome
          ? 'rounded-lg bg-(--surface)/95 px-2.5 py-1.5 text-(--ink) shadow-sm ring-1 ring-black/[0.08]'
          : ''
      } ${className}`}
    >
      <LockIcon />
      private
    </span>
  )
}

/** Icon + label pill, for inline metadata (e.g. a skill row). */
export function VisibilityBadge({
  visibility,
  className = '',
}: {
  visibility: 'public' | 'private'
  className?: string
}) {
  return (
    <Badge variant="default" className={`inline-flex items-center gap-1 ${className}`}>
      {visibility === 'public' ? <GlobeIcon /> : <LockIcon />}
      {visibility}
    </Badge>
  )
}
