import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { auth } from '@/auth'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/ui/avatar'
import { ProfileHeader, profileHeroWash } from '@/components/profile-header'
import { ProfileRail } from '@/components/profile-rail'
import { ClaimMirrorModal } from '@/components/claim-mirror-modal'
import { MirrorProfileCard } from '@/components/mirror-notice'
import { getAuthorProfile } from '@/lib/registry'
import { listMyOrgs } from '@/lib/orgs-server'
import { viewerManagesOrg, viewerOrgRole } from '@/lib/orgs'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'

/**
 * Shared shell for a profile and its connections (followers / following /
 * installs). Owns the identity band and the sidebar rail so navigating between
 * these routes keeps the shell mounted and swaps only the content column — no
 * whole-page re-render. Scoped to the (profile) route group so it never wraps
 * the sibling skill/kit pages. Each page renders only its main column into
 * `children`.
 */
export default async function ProfileLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ author: string }>
}) {
  const { author } = await params
  const session = await auth()
  const [profile, myOrgs] = await Promise.all([
    getAuthorProfile(author, { withSession: true }),
    session?.handle ? listMyOrgs() : Promise.resolve({ kind: 'unauthorized' as const }),
  ])
  if (!profile) notFound()

  const isAuthed = !!session?.user
  const isSelf = session?.handle != null && session.handle === author
  const isTeam = profile.kind === 'team'
  const canManageTeam = isTeam && viewerManagesOrg(myOrgs, author)
  const viewerRole = isTeam ? viewerOrgRole(myOrgs, author) : null

  return (
    <div className="relative">
      {/* Soft identity-tinted wash behind the hero — keyed to the person's hue. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{ background: profileHeroWash(author, profile.avatarUrl) }}
      />
      <main className={`marketing-home consumer-theme relative ${PAGE_CONTAINER_CLASS}`}>
        {/* Same shape as skill/kit: avatar leads the left rail, identity + content
            in the main column, no full-width header band. */}
        <div className="mt-3 grid gap-10 lg:grid-cols-[var(--rail-nav)_minmax(0,1fr)] lg:items-start">
          {/* LEFT rail — avatar, then mirror card + About/Agents. */}
          <aside className="lg:order-first lg:sticky lg:top-24">
            <div className="relative mb-6 aspect-square w-full">
              <Avatar
                src={profile.avatarUrl}
                name={profile.displayName}
                colorKey={author}
                kind={isTeam ? 'team' : 'person'}
                size="xl"
                priority
                // The rail avatar is fluid (full rail width on desktop, the
                // container width on mobile), so hand next/image a width hint —
                // the fixed-size srcset alone renders it upscaled.
                sizes="(min-width: 1024px) 224px, 60vw"
                className="absolute inset-0 h-full w-full shadow-sm ring-1 ring-black/10"
              />
            </div>
            {profile.isMirror && (
              <section className="py-4 first:pt-0">
                <MirrorProfileCard
                  handle={author}
                  sourceUrl={profile.mirrorSourceUrl}
                  license={profile.mirrorLicense}
                  since={profile.joinedAt}
                >
                  <ClaimMirrorModal
                    handle={author}
                    sourceUrl={profile.mirrorSourceUrl ?? null}
                    authed={isAuthed}
                    sourceOwnerType={profile.sourceOwnerType ?? null}
                  />
                </MirrorProfileCard>
              </section>
            )}
            <ProfileRail
              profile={profile}
              isSelf={isSelf}
              isTeam={isTeam}
              viewerRole={viewerRole}
            />
          </aside>

          {/* MAIN — identity (no avatar; it leads the rail) then the tabs/content. */}
          <div className="min-w-0 lg:mt-2 [&>*:first-child]:mt-0">
            <ProfileHeader
              profile={profile}
              author={author}
              isSelf={isSelf}
              isTeam={isTeam}
              isAuthed={isAuthed}
              hideAvatar
              action={
                canManageTeam ? (
                  <Button href={`/settings/teams/${author}`} variant="secondary">
                    Manage team
                  </Button>
                ) : undefined
              }
            />
            <div className="mt-8">{children}</div>
          </div>
        </div>
      </main>
    </div>
  )
}
