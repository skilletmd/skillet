// "Deprecated" status badge.
//
// Reusable across surfaces: the skill page (for owners) and the owner skill
// list / hub. Visually quieter than the gold "verified" / green
// "basic eval" chips — a deprecated skill is sunset, not celebrated — so it
// reads as a muted, struck-through state without screaming danger.

import { Badge } from '@/components/ui/badge'

export function DeprecatedBadge({ className = '' }: { className?: string }) {
  return (
    <Badge
      appearance="chip"
      title="This skill is deprecated. Hidden from the public directory but still visible to you."
      className={className}
    >
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      deprecated
    </Badge>
  )
}
