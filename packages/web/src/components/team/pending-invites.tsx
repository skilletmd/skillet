'use client'

// Pending team invitations addressed to the viewer, shown at the top of
// /settings/teams. Until now an invitee could only act on an invite via the
// emailed deep link (/settings/teams/accept?...); if that email was lost the
// invite was unreachable. This surfaces every invite waiting for you, with the
// team (linked to its page) and who invited you (linked to their profile) for
// trust, plus an inline Accept that reuses the same redeem call as the accept
// page. Accept-only for now — decline can follow.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { acceptInvite } from '@/lib/org-team'
import type { MyInviteEntry } from '@/lib/orgs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Panel } from '@/components/ui/panel'
import { SUBSECTION_LABEL_CLASS } from '@/lib/page-layout'

/** Map redeem failure codes to invitee-facing copy (mirrors the accept page). */
function messageForError(error?: string): string {
  switch (error) {
    case 'invite_not_for_caller':
      return 'This invitation was sent to a different account.'
    case 'invite_already_redeemed':
      return 'This invitation has already been used.'
    case 'invite_not_found':
    case 'org_not_found':
      return 'This invitation is no longer valid.'
    default:
      return 'Couldn’t accept this invitation. Please try again.'
  }
}

function InviteRow({ invite }: { invite: MyInviteEntry }) {
  const router = useRouter()
  const [state, setState] = useState<'idle' | 'accepting' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function onAccept() {
    setState('accepting')
    setMessage(null)
    const result = await acceptInvite(invite.org_slug, invite.invite_id)
    if (result.kind === 'ok') {
      // The list is server-rendered from the viewer's invites; refresh so the
      // accepted invite drops off and the new team appears below.
      router.refresh()
      return
    }
    if (result.kind === 'unauthorized') {
      router.push('/login')
      return
    }
    const code = result.kind === 'error' ? result.error : 'invite_not_for_caller'
    setMessage(messageForError(code))
    setState('error')
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar
          name={invite.org_name}
          colorKey={invite.org_slug}
          kind="team"
          size="md"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <Link
            href={`/${invite.org_slug}`}
            className="block truncate text-sm font-semibold text-(--ink) underline-offset-2 hover:underline"
          >
            {invite.org_name}
          </Link>
          {invite.invited_by_handle && (
            <span className="mt-0.5 flex items-center gap-1.5 text-xs text-(--ink-2)">
              <Avatar
                name={invite.invited_by_handle}
                kind="person"
                size="xxs"
                aria-hidden="true"
              />
              <span className="whitespace-nowrap">invited by</span>
              <Link
                href={`/${invite.invited_by_handle}`}
                className="truncate font-mono text-(--ink) underline-offset-2 hover:underline"
              >
                @{invite.invited_by_handle}
              </Link>
            </span>
          )}
          {message && (
            <p role="alert" className="mt-1 text-xs text-(--danger)">
              {message}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Badge variant="default">{invite.role}</Badge>
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={state === 'accepting'}
          onClick={onAccept}
        >
          {state === 'accepting' ? 'Accepting…' : 'Accept'}
        </Button>
      </div>
    </li>
  )
}

export function PendingInvites({
  invites,
  className,
}: {
  invites: MyInviteEntry[]
  className?: string
}) {
  if (invites.length === 0) return null
  return (
    <section className={className}>
      <h2 className={SUBSECTION_LABEL_CLASS}>
        Pending invitation{invites.length === 1 ? '' : 's'}
      </h2>
      <Panel as="ul" padding="none" className="mt-3 divide-y divide-(--line)">
        {invites.map((invite) => (
          <InviteRow key={invite.invite_id} invite={invite} />
        ))}
      </Panel>
    </section>
  )
}
