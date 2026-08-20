'use client'

// Member-row action controls for the team settings page.
//
// Drop-in clusters the team page mounts at the end of each member /
// pending-invite row. They own no list state of their own: each control calls
// the org-team client (src/lib/org-team.ts) and, on success, invokes
// `onChanged()` so the parent re-fetches the member list. Authorization is
// mirrored from the server (which re-checks every call): the role picker shows
// only for the owner, remove/revoke shows for owner or admin, and the owner row
// is never demotable or removable.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  ASSIGNABLE_ROLES,
  canChangeRoles,
  canRemoveMembers,
  changeMemberRole,
  removeMember,
  type OrgMember,
  type OrgRole,
  type PendingInvite,
  type TeamActionResult,
} from '@/lib/org-team'

const ROLE_BADGE_CLASS =
  'rounded-full bg-(--surface) px-2.5 py-1 font-mono text-xs uppercase tracking-wide text-(--ink-2)'

const SELECT_CLASS =
  'rounded-lg border border-(--line) bg-(--bg) px-2.5 py-1.5 text-sm text-(--ink) transition hover:border-(--ink-2) disabled:cursor-not-allowed disabled:opacity-50'

/** Route signed-out callers to login; surface a short message for anything else. */
function messageFor(result: Exclude<TeamActionResult<unknown>, { kind: 'ok' }>): string {
  switch (result.kind) {
    case 'forbidden':
      return 'You do not have permission to do that.'
    case 'notfound':
      return 'That person is no longer on the team.'
    default:
      return 'Something went wrong. Try again.'
  }
}

export function MemberRowActions({
  orgSlug,
  member,
  viewerRole,
  onChanged,
}: {
  orgSlug: string
  member: OrgMember
  viewerRole: OrgRole | null
  onChanged?: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'role' | 'remove'>(null)
  const [error, setError] = useState<string | null>(null)

  const isOwnerRow = member.role === 'owner'
  const showRolePicker = canChangeRoles(viewerRole) && !isOwnerRow
  const showRemove = canRemoveMembers(viewerRole) && !isOwnerRow

  // The owner row, or a viewer with no privileges, gets just the static badge.
  if (!showRolePicker && !showRemove) {
    return <span className={ROLE_BADGE_CLASS}>{member.role}</span>
  }

  function handleResult(result: TeamActionResult<unknown>): boolean {
    if (result.kind === 'ok') {
      setError(null)
      onChanged?.()
      return true
    }
    if (result.kind === 'unauthorized') {
      router.push('/login')
      return false
    }
    setError(messageFor(result))
    return false
  }

  async function onRoleChange(next: string) {
    if (next === member.role) return
    const role = next as Exclude<OrgRole, 'owner'>
    setBusy('role')
    setError(null)
    const result = await changeMemberRole(orgSlug, member.user_id, role)
    handleResult(result)
    setBusy(null)
  }

  async function onRemove() {
    setBusy('remove')
    setError(null)
    const result = await removeMember(orgSlug, member.user_id)
    handleResult(result)
    setBusy(null)
  }

  const label = member.handle ? `@${member.handle}` : 'this member'

  return (
    <div className="flex items-center gap-2">
      {showRolePicker && (
        <label className="sr-only" htmlFor={`role-${member.user_id}`}>
          Role for {label}
        </label>
      )}
      {showRolePicker && (
        <select
          id={`role-${member.user_id}`}
          className={SELECT_CLASS}
          value={member.role}
          disabled={busy !== null}
          onChange={(e) => onRoleChange(e.target.value)}
        >
          {ASSIGNABLE_ROLES.map((role) => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
      )}
      {showRemove && (
        <Button
          type="button"
          variant="danger-ghost"
          size="sm"
          disabled={busy !== null}
          aria-label={`Remove ${label}`}
          onClick={onRemove}
        >
          {busy === 'remove' ? 'Removing…' : 'Remove'}
        </Button>
      )}
      {error && (
        <span role="alert" className="text-xs text-(--danger)">
          {error}
        </span>
      )}
    </div>
  )
}

export function PendingInviteActions({
  orgSlug,
  invite,
  viewerRole,
  onChanged,
}: {
  orgSlug: string
  invite: PendingInvite
  viewerRole: OrgRole | null
  onChanged?: () => void
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canRemoveMembers(viewerRole)) {
    return <span className={ROLE_BADGE_CLASS}>invited</span>
  }

  const label = invite.handle ? `@${invite.handle}` : (invite.email ?? 'this invite')

  async function onRevoke() {
    setBusy(true)
    setError(null)
    const result = await removeMember(orgSlug, invite.invite_id)
    if (result.kind === 'ok') {
      onChanged?.()
    } else if (result.kind === 'unauthorized') {
      router.push('/login')
    } else {
      setError(messageFor(result))
    }
    setBusy(false)
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="danger-ghost"
        size="sm"
        disabled={busy}
        aria-label={`Revoke invite for ${label}`}
        onClick={onRevoke}
      >
        {busy ? 'Revoking…' : 'Revoke'}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-(--danger)">
          {error}
        </span>
      )}
    </div>
  )
}
