import { auth } from '@/auth'
import { TeamsHeader } from '@/components/team/teams-header'
import { TeamsEmptyState } from '@/components/team/teams-empty-state'
import { TeamManagePanel } from '@/components/team/team-manage-panel'
import { TeamsAccordion, type TeamRow } from '@/components/team/teams-accordion'
import { PendingInvites } from '@/components/team/pending-invites'
import { listMyInvites, listMyOrgs } from '@/lib/orgs-server'

/**
 * The Teams surface: your teams as a list, with one expandable inline to show
 * its management panel. `/settings/teams` shows the list collapsed;
 * `/settings/teams/<slug>` opens that team on load — so the per-team URL stays
 * deep-linkable (profile "Manage team", invite routing). Expanding afterward is
 * client-side (see TeamsAccordion), so the column never refreshes.
 */
export async function TeamsManager({ activeSlug }: { activeSlug: string | null }) {
  const session = await auth()
  const myHandle = session?.handle ?? null
  const [orgs, invitesResult] = await Promise.all([listMyOrgs(), listMyInvites()])
  const orgList = orgs.kind === 'ok' ? orgs.orgs : []
  const invites = invitesResult.kind === 'ok' ? invitesResult.invites : []

  // Pre-render every team's panel on the server so the accordion can show/hide
  // them instantly client-side. Cheap at the team counts users actually have.
  const teams: TeamRow[] = orgList.map((org) => ({
    slug: org.slug,
    name: org.name,
    role: org.role,
    panel: <TeamManagePanel slug={org.slug} myHandle={myHandle} />,
  }))

  const hasTeams = teams.length > 0
  const hasInvites = invites.length > 0

  return (
    <div>
      {/* Header always carries the New-team action unless the page is truly
          empty (no teams and no invites) — then the empty-state card owns it. */}
      <TeamsHeader hideAction={!hasTeams && !hasInvites} />
      {hasInvites && <PendingInvites invites={invites} className="mt-8" />}
      {hasTeams ? (
        <div className={hasInvites ? 'mt-10' : undefined}>
          <TeamsAccordion teams={teams} initialOpen={activeSlug} />
        </div>
      ) : (
        // Only nudge team creation when there's nothing else on the page; with a
        // pending invite the header's New-team action is enough.
        !hasInvites && (
          <div className="mt-6">
            <TeamsEmptyState />
          </div>
        )
      )}
    </div>
  )
}
