import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { EditDisplayName } from '@/components/edit-display-name'
import { InviteMemberForm } from '@/components/team/invite-member-form'
import { TeamPanelTabs } from '@/components/team/team-panel-tabs'
import {
  MemberRowActionsLive,
  PendingInviteActionsLive,
} from '@/components/team/member-row-actions-live'
import { type MemberRole, type OrgMember } from '@/lib/orgs'
import { listOrgMembers } from '@/lib/orgs-server'
import { getAuthorProfile } from '@/lib/registry'
import { SettingsList } from '@/components/ui/settings-list'
import { SettingsSection } from '@/components/ui/setting-section'
import { SUBSECTION_LABEL_CLASS } from '@/lib/page-layout'

const ROLE_RANK: Record<MemberRole, number> = { owner: 0, admin: 1, member: 2 }

function RoleBadge({ role }: { role: MemberRole }) {
  return <Badge variant="default">{role}</Badge>
}

function Count({ n }: { n: number }) {
  return <span className="ml-2 text-base font-normal tabular-nums text-(--ink-2)">{n}</span>
}

/**
 * The management body for one team — members, pending invites, the invite form,
 * and the publish shortcuts. Rendered inline under a team's row on the Teams
 * page (the row supplies the name/heading and the expand/collapse affordance).
 */
export async function TeamManagePanel({
  slug,
  myHandle,
}: {
  slug: string
  myHandle: string | null
}) {
  const result = await listOrgMembers(slug)
  if (result.kind !== 'ok') {
    return <p className="text-sm text-(--ink-2)">Couldn’t load this team. Please try again.</p>
  }

  const { org, members, pending } = result.data
  const me = members.find((m) => m.handle && m.handle === myHandle)
  const canInvite = me?.role === 'owner' || me?.role === 'admin'

  // Admins/owners can edit the team's public profile (logo, bio, link). Load its
  // current values to pre-fill the editor; members never see it, so skip the fetch.
  const teamProfile = canInvite ? await getAuthorProfile(org.slug, { withSession: true }) : null
  const sorted: OrgMember[] = [...members].sort(
    (a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.invited_at - b.invited_at,
  )

  // Members carry only a handle — enrich with each person's profile so the rows
  // show their real name and avatar (not just the handle). One lookup per handle.
  const handles = [...new Set([...members, ...pending].map((x) => x.handle).filter(Boolean))]
  const profiles = new Map(
    await Promise.all(
      handles.map(
        async (h) =>
          [
            h,
            await getAuthorProfile(h as string, { withSession: true }).catch(() => null),
          ] as const,
      ),
    ),
  )

  // Team profile editor — admins/owners only. Reuses the personal profile editor
  // in team mode (logo upload, bio, link), scoped to the team's @slug.
  const profileSection = (
    <EditDisplayName
      kind="team"
      author={org.slug}
      initialName={teamProfile?.displayName ?? org.name}
      initialBio={teamProfile?.bio}
      initialProfileUrl={teamProfile?.profileUrl}
      initialXHandle={teamProfile?.socials?.twitter}
      initialAvatarUrl={teamProfile?.avatarUrl}
    />
  )

  const membersSection = (
    <div className="space-y-10">
      <SettingsSection
        title={
          <>
            Members
            <Count n={members.length} />
          </>
        }
        // What each role can do — owners are admins who can also change roles.
        description={
          <>
            <span className="font-medium text-(--ink)">Admins</span>{' '}
            invite members, edit the team profile, and publish skills &amp; kits.{' '}
            <span className="font-medium text-(--ink)">Members</span> can view the team’s private
            skills and propose updates.
          </>
        }
      >
        <SettingsList>
          {sorted.map((m) => {
            const profile = m.handle ? profiles.get(m.handle) : null
            const name = profile?.displayName?.trim() || (m.handle ? `@${m.handle}` : 'Member')
            const showHandle = !!profile?.displayName?.trim() && !!m.handle
            const isMe = !!m.handle && m.handle === myHandle
            return (
              <li
                key={m.user_id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    src={profile?.avatarUrl}
                    name={name}
                    colorKey={m.handle ?? m.user_id}
                    size="md"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-base font-medium text-(--ink)">
                      {name}
                      {isMe && <span className="ml-1.5 font-normal text-(--ink-2)">(you)</span>}
                    </span>
                    {showHandle && (
                      <span className="block truncate font-mono text-xs text-(--ink-2)">
                        @{m.handle}
                      </span>
                    )}
                  </span>
                </div>
                <MemberRowActionsLive orgSlug={org.slug} member={m} viewerRole={me?.role ?? null} />
              </li>
            )
          })}
        </SettingsList>

        {pending.length > 0 && (
          <div className="mt-6 border-t border-(--line) pt-6">
            <h3 className={SUBSECTION_LABEL_CLASS}>Pending ({pending.length})</h3>
            <SettingsList className="mt-3">
              {pending.map((p) => {
                const profile = p.handle ? profiles.get(p.handle) : null
                const name =
                  profile?.displayName?.trim() ||
                  (p.handle ? `@${p.handle}` : (p.email ?? 'Invited'))
                return (
                  <li
                    key={p.invite_id}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar
                        src={profile?.avatarUrl}
                        name={name}
                        colorKey={p.handle ?? p.email ?? p.invite_id}
                        size="md"
                        aria-hidden="true"
                      />
                      <span className="min-w-0 truncate text-base text-(--ink-2)">{name}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <RoleBadge role={p.role} />
                      <PendingInviteActionsLive
                        orgSlug={org.slug}
                        invite={p}
                        viewerRole={me?.role ?? null}
                      />
                    </div>
                  </li>
                )
              })}
            </SettingsList>
          </div>
        )}

        {canInvite && (
          <div className="mt-6 border-t border-(--line) pt-6">
            <h3 className={SUBSECTION_LABEL_CLASS}>Invite a member</h3>
            <div className="mt-3">
              <InviteMemberForm slug={org.slug} canInvite={canInvite} />
            </div>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title={`Publish to @${org.slug}`}
        description="Kits and skills you publish here live under the team, so everyone installs the same versions. They show up on the team page."
      >
        <div className="flex flex-wrap items-center gap-2">
          {canInvite && (
            <>
              <Button href={`/kits/new?team=${encodeURIComponent(org.slug)}`} variant="secondary">
                New kit
              </Button>
              <Button href={`/skills/new?team=${encodeURIComponent(org.slug)}`} variant="secondary">
                New skill
              </Button>
            </>
          )}
          <Button href={`/${org.slug}`} variant={canInvite ? 'tertiary' : 'secondary'}>
            View team page
          </Button>
        </div>
      </SettingsSection>
    </div>
  )

  // Admins get tabs (Members | Profile) so the panel doesn't run on forever.
  // Members have no Profile tab, so they just get the members view, no tab bar.
  if (canInvite) {
    return <TeamPanelTabs members={membersSection} profile={profileSection} />
  }
  return membersSection
}
