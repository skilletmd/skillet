// Invitee acceptance route for email / unknown-handle org invites.
//
// The team page owns /settings/teams itself; this is the separate
// landing an invitee follows from their invitation link. It gates on a signed-in
// session, then hands the org slug + invite id to the client redeemer, which
// calls the registry accept endpoint and routes the new member into the team.
import type { ReactNode } from 'react'
import Link from 'next/link'
import { auth } from '@/auth'
import { SignInProviderButton } from '@/components/sign-in-provider-button'
import { AcceptInviteClient } from '@/components/team/accept-invite-client'
import { listMyInvites } from '@/lib/orgs-server'
import { PageHeader } from '@/components/page-header'
import { PAGE_LEDE_CLASS } from '@/lib/page-layout'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'

export const metadata = {
  title: 'Accept team invitation · Skillet',
  robots: { index: false },
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null
  return typeof value === 'string' && value.length > 0 ? value : null
}

async function AcceptInvitePageContent({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const params = await searchParams
  const orgSlug = firstParam(params.org)
  const inviteId = firstParam(params.invite)

  const shell = (body: ReactNode) => (
    <div className="mx-auto max-w-lg">
      <PageHeader title="Accept invitation" />
      {body}
    </div>
  )

  if (!orgSlug || !inviteId) {
    return shell(
      <p className={PAGE_LEDE_CLASS}>
        This invitation link is missing or malformed. Ask the team owner to send you a new one.
      </p>,
    )
  }

  const session = await auth()
  if (!session?.user) {
    const returnTo = `/settings/teams/accept?org=${encodeURIComponent(orgSlug)}&invite=${encodeURIComponent(inviteId)}`
    return shell(
      <>
        <p className={PAGE_LEDE_CLASS}>
          Sign in to accept your invitation to the <span className="font-mono">{orgSlug}</span>{' '}
          team. Use the account the invitation was sent to.
        </p>
        <div className="mt-6 space-y-3">
          <SignInProviderButton provider="github" redirectTo={returnTo} />
          <SignInProviderButton provider="google" redirectTo={returnTo} />
        </div>
        <p className="mt-6 text-sm text-(--ink-2)">
          Already have a different account open?{' '}
          <Link href="/settings" className="font-medium text-(--ink) underline underline-offset-2">
            Check which account you are signed in as
          </Link>
          .
        </p>
      </>,
    )
  }

  // Enrich the panel with the team name + who invited you (for trust) by
  // looking the invite up in the viewer's own invite list. Absent for stale or
  // foreign links — the client still works from slug + id alone.
  const mine = await listMyInvites()
  const match =
    mine.kind === 'ok' ? mine.invites.find((i) => i.invite_id === inviteId) : undefined

  return shell(
    <AcceptInviteClient
      orgSlug={orgSlug}
      inviteId={inviteId}
      orgName={match?.org_name ?? null}
      invitedByHandle={match?.invited_by_handle ?? null}
    />,
  )
}

export default function AcceptInvitePage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  return (
    <DynamicPageBoundary>
      <AcceptInvitePageContent {...props} />
    </DynamicPageBoundary>
  )
}
