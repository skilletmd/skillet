// Count pill for pending proposals.
//
// Pure + presentational so the same badge can sit on the skill detail header,
// the owner's skill list, and the profile area without duplicating logic. The
// count is the *pending* count only — once a proposal is decided it drops out
// of the list upstream, so the badge decrements on its own. Renders
// nothing at zero: an empty "0" badge is noise, not a signal.

import { Badge } from '@/components/ui/badge'

export function PendingProposalsBadge({
  count,
  className = '',
}: {
  count: number
  className?: string
}) {
  if (count <= 0) return null

  const label = count === 1 ? '1 proposal pending' : `${count} proposals pending`

  return (
    <Badge
      variant="accent-soft"
      appearance="chip"
      role="status"
      aria-label={label}
      title={label}
      className={className}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-(--accent)" />
      <span className="tabular-nums">{count}</span>
      <span>pending</span>
    </Badge>
  )
}
