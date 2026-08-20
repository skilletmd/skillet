import { redirect } from 'next/navigation'

// Team settings moved from /settings/team to /settings/teams.
export default function LegacyTeamSettingsRedirect() {
  redirect('/settings/teams')
}
