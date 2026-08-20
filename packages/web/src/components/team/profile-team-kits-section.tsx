import type { AuthorProfileKit } from '@/lib/types'
import { KitCard } from '@/components/kit-card'
import { LibrarySection } from '@/components/library-section'
import { EmptyState } from '@/components/ui/empty-state'
import { MuteTeamKitToggle } from '@/components/team/mute-team-kit-toggle'
import { KIT_CARD_GRID } from '@/lib/page-layout'
import { kitHrefFromRecord } from '@/lib/urls'

/** One team the viewer belongs to, plus the kits it publishes. */
export interface TeamKitsGroup {
  slug: string
  name: string
  kits: AuthorProfileKit[]
}

/**
 * The Teams tab on your own profile: the kits you get by belonging to a team,
 * grouped per team. These are neither Created (you didn't make them) nor Saved
 * (you didn't collect them) — they come with membership, so they live here. Each
 * kit carries a Mute control to stop it syncing to your agents.
 */
export function ProfileTeamKitsSection({
  teams,
  mutedKitIds,
}: {
  teams: TeamKitsGroup[]
  mutedKitIds: string[]
}) {
  if (teams.length === 0) {
    return <EmptyState>No team kits yet. Kits your teams publish show up here.</EmptyState>
  }
  const muted = new Set(mutedKitIds)

  return (
    <div className="space-y-10">
      {teams.map((team) => (
        <LibrarySection
          key={team.slug}
          id={`team-${team.slug}`}
          level="eyebrow"
          title={team.name}
          count={team.kits.length}
          createLabel=""
        >
          {/* KIT_CARD_GRID uses container-query columns, so it needs an
              @container ancestor (same as ProfileKitsSection) — without it the
              grid stays one column and the cards stretch. */}
          <div className="@container">
            <ul className={KIT_CARD_GRID}>
              {team.kits.map((kit) => (
                <li key={kit.id}>
                  <KitCard
                    kitId={kit.id}
                    href={kitHrefFromRecord({
                      owner: kit.owner ?? team.slug,
                      slug: kit.slug,
                      id: kit.id,
                    })}
                    name={kit.name}
                    owner={kit.owner ?? team.slug}
                    skillCount={kit.skillCount}
                    skillRefs={kit.skillRefs ?? []}
                    skillCategories={kit.skillCategories ?? []}
                    category={kit.category}
                    visibility={kit.visibility}
                    makerAvatarUrl={kit.avatarUrl}
                    menu={<MuteTeamKitToggle kitId={kit.id} initialMuted={muted.has(kit.id)} />}
                  />
                </li>
              ))}
            </ul>
          </div>
        </LibrarySection>
      ))}
    </div>
  )
}
