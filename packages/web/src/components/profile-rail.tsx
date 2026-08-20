import Link from 'next/link'
import { ProfileAboutRail, ProfileAgentsRail } from '@/components/profile-header'
import { UsedByFacepile } from '@/components/kits/used-by'
import { Eyebrow } from '@/components/ui/eyebrow'
import type { MemberRole } from '@/lib/orgs'
import type { AuthorProfile } from '@/lib/types'

// "You're a member of this team" — confirms membership for a viewer who belongs
// to the team, so the absence of manage controls reads as "member" not "logged
// out". Owner is singular ("the owner"); admin/member take an article.
const ROLE_LINE: Record<MemberRole, string> = {
  owner: 'You’re the owner of this team',
  admin: 'You’re an admin of this team',
  member: 'You’re a member of this team',
}

/**
 * The profile identity rail — Members (teams), About, Agents, and the
 * make-your-own nudge. Shared by the profile page and its connections views
 * (followers / following / installs) so every profile surface carries the same
 * sidebar. The profile page renders the mirror/claim card above this; that's
 * landing-specific onboarding, not identity, so it stays there.
 */
export function ProfileRail({
  profile,
  isSelf,
  isTeam,
  viewerRole = null,
}: {
  profile: AuthorProfile
  isSelf: boolean
  isTeam: boolean
  /** The viewer's role in this team, when they're a member; null otherwise. */
  viewerRole?: MemberRole | null
}) {
  return (
    <>
      {isTeam && (profile.members?.length ?? 0) > 0 && (
        <section className="py-4 first:pt-0">
          <Eyebrow>
            Members <span className="font-normal text-(--ink-3)">{profile.members!.length}</span>
          </Eyebrow>
          <div className="mt-3">
            <UsedByFacepile
              faces={profile.members!.map((m) => ({
                handle: m.handle,
                name: m.name,
                avatarUrl: m.avatarUrl,
              }))}
              size="md"
              linkFaces
            />
          </div>
          {viewerRole && (
            <p className="mt-3 text-sm text-(--ink-2)">{ROLE_LINE[viewerRole]}</p>
          )}
        </section>
      )}

      <section className="py-4 first:pt-0">
        <Eyebrow>About</Eyebrow>
        <div className="mt-3">
          <ProfileAboutRail profile={profile} isTeam={isTeam} />
        </div>
      </section>

      {((profile.runtimes?.length ?? 0) > 0 || (profile.detectedRuntimes?.length ?? 0) > 0) && (
        <section className="py-4 first:pt-0">
          <Eyebrow>Agents</Eyebrow>
          <div className="mt-3">
            <ProfileAgentsRail profile={profile} />
          </div>
        </section>
      )}

      {!isSelf && (
        <section className="py-4 first:pt-0">
          <Eyebrow>Make your own</Eyebrow>
          <p className="mt-2 text-sm leading-relaxed text-(--ink-2)">
            Publish a skill or bundle your favorites into a kit.
          </p>
          <Link
            href="/create"
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-(--accent) hover:underline"
          >
            Get started →
          </Link>
        </section>
      )}
    </>
  )
}
