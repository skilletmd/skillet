'use client'

// Invitee acceptance flow for email / unknown-handle invites.
//
// Email and unknown-handle invites create a pending `organization_invites` row
// with no member yet. The invitee follows a link to
// /settings/teams/accept?org=<slug>&invite=<id>, and this client redeems it
// against the registry, which verifies the signed-in caller actually matches
// the invite (session handle, or an email on a linked identity). On success it
// routes the new member into the team page.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { acceptInvite, type AcceptedOrg } from '@/lib/org-team'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'

const TEAM_HREF = '/settings/teams'

type State =
  | { kind: 'idle' }
  | { kind: 'accepting' }
  | { kind: 'accepted'; org: AcceptedOrg }
  | { kind: 'error'; message: string }

/** Map the redeem failure codes to invitee-facing copy. */
function messageForError(error?: string): string {
  switch (error) {
    case 'invite_not_for_caller':
      return 'This invitation was sent to a different account. Sign in as the invited person and try again.'
    case 'invite_already_redeemed':
      return 'This invitation has already been used.'
    case 'invite_not_found':
    case 'org_not_found':
      return 'This invitation is no longer valid. Ask the team owner to send a new one.'
    default:
      return 'We could not accept this invitation. Please try again.'
  }
}

export function AcceptInviteClient({
  orgSlug,
  inviteId,
  orgName,
  invitedByHandle,
}: {
  orgSlug: string
  inviteId: string
  /** Enrichment from the recipient's invite list; absent for stale/foreign links. */
  orgName?: string | null
  invitedByHandle?: string | null
}) {
  const router = useRouter()
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function onAccept() {
    setState({ kind: 'accepting' })
    const result = await acceptInvite(orgSlug, inviteId)
    if (result.kind === 'ok') {
      setState({ kind: 'accepted', org: result.data.org })
      router.push(TEAM_HREF)
      return
    }
    if (result.kind === 'unauthorized') {
      router.push('/login')
      return
    }
    if (result.kind === 'notfound') {
      setState({ kind: 'error', message: messageForError('invite_not_found') })
      return
    }
    const code = result.kind === 'error' ? result.error : 'invite_not_for_caller'
    setState({ kind: 'error', message: messageForError(code) })
  }

  if (state.kind === 'accepted') {
    return (
      <Panel padding="lg" className="mt-8">
        <p className="text-base text-(--ink)">
          You have joined <span className="font-semibold">{state.org.name}</span>.
        </p>
        <Link
          href={TEAM_HREF}
          className="mt-4 inline-block text-sm font-medium text-(--ink) underline underline-offset-2"
        >
          Go to the team →
        </Link>
      </Panel>
    )
  }

  return (
    <Panel padding="lg" className="mt-8">
      <p className="text-base leading-relaxed text-(--ink-2)">
        You have been invited to join the{' '}
        <Link
          href={`/${orgSlug}`}
          className="font-semibold text-(--ink) underline-offset-2 hover:underline"
        >
          {orgName?.trim() || orgSlug}
        </Link>{' '}
        team on Skillet.
        {invitedByHandle && (
          <>
            {' Invited by '}
            <Link
              href={`/${invitedByHandle}`}
              className="font-mono text-(--ink) underline-offset-2 hover:underline"
            >
              @{invitedByHandle}
            </Link>
            .
          </>
        )}{' '}
        Accept the invitation to become a member.
      </p>
      <div className="mt-6">
        <Button
          type="button"
          variant="primary"
          disabled={state.kind === 'accepting'}
          onClick={onAccept}
        >
          {state.kind === 'accepting' ? 'Accepting…' : 'Accept invitation'}
        </Button>
      </div>
      {state.kind === 'error' && (
        <p role="alert" className="mt-4 text-sm text-(--danger)">
          {state.message}
        </p>
      )}
    </Panel>
  )
}
