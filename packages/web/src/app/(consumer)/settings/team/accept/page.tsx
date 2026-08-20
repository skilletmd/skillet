import { redirect } from 'next/navigation'

// Invite acceptance moved from /settings/team/accept to /settings/teams/accept.
// Preserve the ?org= and ?invite= params the invitation link carries.
export default async function LegacyTeamAcceptRedirect({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const sp = await searchParams
  const qs = new URLSearchParams()
  const org = typeof sp.org === 'string' ? sp.org : undefined
  const invite = typeof sp.invite === 'string' ? sp.invite : undefined
  if (org) qs.set('org', org)
  if (invite) qs.set('invite', invite)
  const query = qs.toString()
  redirect(query ? `/settings/teams/accept?${query}` : '/settings/teams/accept')
}
