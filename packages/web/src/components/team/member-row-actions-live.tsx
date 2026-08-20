'use client'

// Server→client seam for the team page member/pending rows.
//
// MemberRowActions / PendingInviteActions re-fetch the list through
// an `onChanged` callback after a mutation, which a server component can't
// supply. These thin client wrappers inject `router.refresh()` so the team
// page (a server component) can mount the action clusters directly in each row
// and have the list re-render after a revoke / role change.
import { useRouter } from 'next/navigation'
import { MemberRowActions, PendingInviteActions } from '@/components/team/member-row-actions'
import type { OrgMember, OrgRole, PendingInvite } from '@/lib/org-team'

export function MemberRowActionsLive({
  orgSlug,
  member,
  viewerRole,
}: {
  orgSlug: string
  member: OrgMember
  viewerRole: OrgRole | null
}) {
  const router = useRouter()
  return (
    <MemberRowActions
      orgSlug={orgSlug}
      member={member}
      viewerRole={viewerRole}
      onChanged={() => router.refresh()}
    />
  )
}

export function PendingInviteActionsLive({
  orgSlug,
  invite,
  viewerRole,
}: {
  orgSlug: string
  invite: PendingInvite
  viewerRole: OrgRole | null
}) {
  const router = useRouter()
  return (
    <PendingInviteActions
      orgSlug={orgSlug}
      invite={invite}
      viewerRole={viewerRole}
      onChanged={() => router.refresh()}
    />
  )
}
