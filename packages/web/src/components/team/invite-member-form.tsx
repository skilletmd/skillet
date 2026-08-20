'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { inviteMemberAction, type InviteState } from '@/app/(consumer)/settings/teams/actions'
import { INVITABLE_ROLES } from '@/lib/orgs'
import { Button } from '@/components/ui/button'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} variant="primary" className="shrink-0">
      {pending ? 'Inviting…' : 'Invite'}
    </Button>
  )
}

export function InviteMemberForm({ slug, canInvite }: { slug: string; canInvite: boolean }) {
  const [state, action] = useActionState<InviteState, FormData>(inviteMemberAction, {})

  if (!canInvite) {
    return (
      <p className="mt-4 text-sm text-(--ink-2)">Only owners and admins can invite new members.</p>
    )
  }

  return (
    <form action={action} className="mt-4">
      <input type="hidden" name="slug" value={slug} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor="invite-identifier">
          Handle or email
        </label>
        <input
          id="invite-identifier"
          name="identifier"
          required
          autoComplete="off"
          placeholder="handle or email@company.com"
          className="ui-input sm:min-w-0 sm:flex-1"
        />
        <label className="sr-only" htmlFor="invite-role">
          Role
        </label>
        <select
          id="invite-role"
          name="role"
          defaultValue="member"
          className="ui-input sm:w-36! sm:flex-none"
        >
          {INVITABLE_ROLES.map((role) => (
            <option key={role} value={role}>
              {role.charAt(0).toUpperCase() + role.slice(1)}
            </option>
          ))}
        </select>
        <SubmitButton />
      </div>

      {state.error && (
        <p role="alert" className="mt-3 text-sm text-(--danger)">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="mt-3 text-sm text-(--success)">
          {state.message}
        </p>
      )}
    </form>
  )
}
