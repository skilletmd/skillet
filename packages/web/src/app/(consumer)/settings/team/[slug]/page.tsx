import { redirect } from 'next/navigation'

// Team management moved from /settings/team/[slug] to /settings/teams/[slug].
export default async function LegacyTeamManageRedirect({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  redirect(`/settings/teams/${slug}`)
}
