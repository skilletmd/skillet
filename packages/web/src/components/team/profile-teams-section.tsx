import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export function ProfileTeamsSection({
  teams,
  showManageLinks = true,
  showCreateLink = false,
}: {
  teams: Array<{ slug: string; name: string; role: string }>
  showManageLinks?: boolean
  showCreateLink?: boolean
}) {
  if (teams.length === 0 && !showCreateLink) return null

  return (
    <section className="pb-10" aria-labelledby="profile-teams-heading">
      <p className="font-mono text-sm tracking-[0.01em] text-(--accent)">teams</p>
      <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 id="profile-teams-heading" className="text-2xl font-semibold leading-[1.2]">
          Teams
        </h2>
        {showCreateLink && (
          <Button href="/settings/teams" variant="secondary">
            Create a team
          </Button>
        )}
      </div>
      {teams.length > 0 ? (
        <ul className="mt-6 divide-y divide-(--line) border-y border-(--line)">
          {teams.map((team) => (
            <li key={team.slug}>
              <div className="flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link
                    href={`/${team.slug}`}
                    className="text-lg font-semibold text-(--ink) hover:text-(--accent)"
                  >
                    {team.name}
                  </Link>
                  <p className="mt-1 font-mono text-sm text-(--ink-2)">@{team.slug}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">{team.role}</Badge>
                  {showManageLinks && (
                    <Button href={`/settings/teams/${team.slug}`} variant="secondary">
                      Manage
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 text-sm leading-relaxed text-(--ink-2)">No teams yet.</p>
      )}
    </section>
  )
}
