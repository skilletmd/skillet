import { notFound } from 'next/navigation'
import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import { markdownAlternates } from '@/lib/markdown-alternate'
import { auth } from '@/auth'
import { ClaimResultToast } from '@/components/claim-result-toast'
import {
  ClaimResultNotice,
  parseClaimResult,
  GH_CLAIM_RESULT_COOKIE,
} from '@/components/mirror-notice'
import { SkillCard } from '@/components/skill-card'
import { SummonSuggestions } from '@/components/summon-suggestions'
import { ProfileSkillsManager } from '@/components/profile-skills-manager'
import { ProfileKitsSection } from '@/components/kits/profile-kits-section'
import { ProfileActivity } from '@/components/profile-activity'
import { ProfileTabs } from '@/components/profile-tabs'
import { LibrarySection } from '@/components/library-section'
import { getAuthorKit } from '@/lib/kits-server'
import { listMyOrgs, getMutedTeamKitIds } from '@/lib/orgs-server'
import { viewerManagesOrg } from '@/lib/orgs'
import { ProfileTeamKitsSection } from '@/components/team/profile-team-kits-section'
import { SKILL_CARD_GRID } from '@/lib/page-layout'
import { EmptyState } from '@/components/ui/empty-state'
import { getAuthorProfile, getAuthorProfileCached, getProfileActivity } from '@/lib/registry'
import { ogImagePath, OG } from '@/lib/og'

/** A profile skill rendered in the shared Browse card language (mesh cover from
 *  the skill's category, sans handle, "Used by" proof), with the owner's Edit
 *  control beside the Add. */
function ProfileSkillCard({
  author,
  slug,
  title,
  description,
  installCount,
  category,
  isPrivate,
  editHref,
  avatarUrl,
  hideAuthor,
}: {
  author: string
  slug: string
  title?: string | null
  description: string | null
  installCount: number
  category?: string | null
  isPrivate?: boolean
  editHref?: string
  avatarUrl?: string | null
  /** Hide the byline only when the card's author IS the page (Created tab). */
  hideAuthor?: boolean
}) {
  return (
    <SkillCard
      size="md"
      author={author}
      slug={slug}
      title={title}
      description={description}
      category={category}
      installCount={installCount}
      visibility={isPrivate ? 'private' : 'public'}
      editHref={editHref}
      makerAvatarUrl={avatarUrl ?? null}
      hideAuthor={hideAuthor}
    />
  )
}

interface Params {
  author: string
}

// No generateStaticParams: the registry may be unreachable at build time (local CI,
// deploy before registry is up). An empty list crashes under Cache Components;
// profiles render on-demand and stay server-rendered for SEO.

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { author } = await params
  // Metadata is non-critical: degrade a registry outage to empty metadata; the
  // page body raises the unavailable state through its error boundary.
  // Anonymous, request-deduped read (R4): shares one `/authors/:author` fetch
  // with any other anonymous consumer in this render; the body's session-scoped
  // read stays separate (it carries the viewer's token).
  const profile = await getAuthorProfileCached(author).catch(() => null)
  if (!profile) return {}
  // Public skills only, and their top categories (most-published first) — mirrors
  // the /browse people card; saved/private don't count toward a public profile.
  const publicSkills = profile.skills.filter((s) => s.visibility !== 'private')
  const catCounts = new Map<string, number>()
  for (const s of publicSkills) {
    if (s.category) catCounts.set(s.category, (catCounts.get(s.category) ?? 0) + 1)
  }
  const topCats = [...catCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([c]) => c)
  const ogUrl = ogImagePath(
    OG.profile({
      handle: author,
      name: profile.displayName,
      bio: profile.bio,
      followers: profile.followers,
      installs: profile.totalInstalls,
      skills: publicSkills.length,
      cats: topCats,
      isTeam: profile.kind === 'team',
    }),
  )
  return {
    title: `${profile.displayName} (@${author}) · Skillet`,
    description: profile.bio ?? `Skills published by @${author} on Skillet.`,
    alternates: markdownAlternates(`/${author}`),
    openGraph: {
      title: `${profile.displayName} on Skillet`,
      description: profile.bio ?? `Skills published by @${author} on Skillet.`,
      type: 'profile',
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', images: [ogUrl] },
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

export default async function AuthorPage({
  params,
  searchParams,
}: {
  params: Promise<Params>
  searchParams: Promise<{ tab?: string }>
}) {
  const { author } = await params
  const { tab } = await searchParams
  const session = await auth()
  // Read the claim outcome the GitHub grant callback handed off via a
  // short-lived httpOnly cookie, then best-effort clear it so it shows once. The
  // classification comes from this server-read cookie, never the URL, so a denied
  // result can't be flipped client-side.
  const jar = await cookies()
  const claimResult = parseClaimResult(jar.get(GH_CLAIM_RESULT_COOKIE)?.value)
  if (claimResult) {
    // Cookie mutation isn't permitted during render in every Next context; the
    // cookie is short-lived (maxAge 120s) so it self-clears regardless.
    try {
      jar.delete(GH_CLAIM_RESULT_COOKIE)
    } catch {
      /* expires on its own */
    }
  }
  const [profile, authorKit, myOrgs, activity] = await Promise.all([
    getAuthorProfile(author, { withSession: true }),
    getAuthorKit(author),
    session?.handle ? listMyOrgs() : Promise.resolve({ kind: 'unauthorized' as const }),
    getProfileActivity(author),
  ])
  if (!profile) notFound()

  // Viewer identity from the request-cached session, not a live /whoami round-trip.
  const isSelf = session?.handle != null && session.handle === author
  const isTeam = profile.kind === 'team'
  const viewerHandle = session?.handle ?? null
  const canManageTeam = isTeam && viewerManagesOrg(myOrgs, author)
  // The author's default "everything they publish" kit. Outside viewers get a
  // subscribe action on it; the owner/team-manager sees the same card with no
  // action (you don't subscribe to yourself), so it shows everywhere it exists —
  // matching the Saved kit and other people's profiles.
  const showAuthorKit = authorKit.kind === 'ok'
  const authorKitRef =
    showAuthorKit && authorKit.kind === 'ok'
      ? {
          owner: author,
          // The author kit is the person, not a named kit: a viewer-relative
          // possessive name (teams keep their name + the 'team' badge instead).
          name: isTeam
            ? authorKit.kit.name || profile.displayName
            : isSelf
              ? 'Your skills'
              : `${profile.displayName}'s skills`,
          skillCount: authorKit.kit.skills?.length ?? 0,
          // Owner only. The registry serves this kit public-only because it is
          // what subscribers receive, so an owner's unpublished work would
          // otherwise read as nothing at all. Outside viewers keep seeing just
          // the published count, and the number never enters the subscription.
          privateCount: isSelf
            ? profile.skills.filter((s) => s.visibility === 'private').length
            : undefined,
          skillRefs: (authorKit.kit.skills ?? []).map((s) => s.skill_id.replace(':', '/')),
          skillCategories: (authorKit.kit.skills ?? []).map((s) => s.category ?? null),
          subscribed: !!authorKit.kit.subscribed,
          isTeam,
          avatarUrl: authorKit.kit.avatar_url ?? profile.avatarUrl ?? null,
        }
      : undefined
  // Authored surface (this profile's own work) vs Saved (kits/authors they
  // follow), kept on separate tabs — like GitHub Repositories vs Stars. The
  // profile never blends "made by me" with "I follow this" in one grid.
  const savedKits = profile.subscribedKits ?? []
  const savedAuthorKits = profile.subscribedAuthorKits ?? []
  // Individual skills you saved with one click live in your auto "Saved" kit.
  // Public saves show on anyone's profile as social proof; the owner also sees
  // their private saves. The registry applies that visibility rule server-side.
  const savedSkills = profile.savedSkills ?? []
  const savedCount = savedKits.length + savedAuthorKits.length + savedSkills.length
  const yoursKitsCount = (profile.kits?.length ?? 0) + (authorKitRef ? 1 : 0)
  const showSaved = isSelf || savedCount > 0
  const emptySkillsCopy = isTeam
    ? 'No public team skills yet. Private team skills only appear to members.'
    : 'No public skills yet. Private skills only appear to their owner.'

  // Teams tab (your own profile only): the kits you get by belonging to a team,
  // grouped per team, each with a mute control. Neither Created nor Saved — they
  // come with membership. Fetch each team's kits and your muted set.
  const myTeams = isSelf && myOrgs.kind === 'ok' ? myOrgs.orgs : []
  const [teamKitGroups, mutedTeamKitIds] = await Promise.all([
    Promise.all(
      myTeams.map(async (org) => {
        const teamProfile = await getAuthorProfile(org.slug, { withSession: true }).catch(() => null)
        return { slug: org.slug, name: org.name, kits: teamProfile?.kits ?? [] }
      }),
    ),
    myTeams.length > 0 ? getMutedTeamKitIds() : Promise.resolve(new Set<string>()),
  ])
  const teamsWithKits = teamKitGroups.filter((t) => t.kits.length > 0)
  const teamKitsCount = teamsWithKits.reduce((n, t) => n + t.kits.length, 0)
  const showTeams = teamsWithKits.length > 0
  const teamsPanel = (
    <ProfileTeamKitsSection teams={teamsWithKits} mutedKitIds={[...mutedTeamKitIds]} />
  )

  // The authored surface: kits this profile created (incl. their author-kit) and
  // the skills they wrote. No subscriptions here — those live under Saved.
  const createdPanel = (
    <div className="space-y-10">
      {/* Above the kits: the one action here that costs the visitor nothing. */}
      <SummonSuggestions
        author={profile.username}
        suggestions={profile.suggestions ?? []}
        voice={profile.suggestionsVoice ?? 'third-person'}
      />
      <LibrarySection
        id="kits"
        level="eyebrow"
        title="Kits"
        count={yoursKitsCount}
        // Creation is a global act (the nav +); the profile shows you as
        // others see you. Empty states still offer the create path in-context.
        createLabel=""
      >
        <ProfileKitsSection
          author={author}
          createdKits={profile.kits ?? []}
          subscribedKits={[]}
          subscribedAuthorKits={[]}
          authorKit={authorKitRef}
          viewerHandle={viewerHandle}
          isSelf={isSelf || canManageTeam}
        />
      </LibrarySection>

      <ProfileSkillsManager
        skills={profile.skills}
        isSelf={isSelf}
        avatarUrl={profile.avatarUrl}
        emptyCopy={emptySkillsCopy}
      />
    </div>
  )

  // Saved = what this profile follows/collected (others' work). GitHub Stars.
  // Symmetric with Yours: a Kits row (subscribed kits/authors) and a Skills row
  // (the one-click picks in your Saved kit).
  const hasSavedKits = savedKits.length + savedAuthorKits.length > 0
  const savedPanel =
    savedCount > 0 ? (
      <div className="space-y-10">
        <LibrarySection
          id="saved-kits"
          level="eyebrow"
          title="Kits"
          count={savedKits.length + savedAuthorKits.length}
          createLabel=""
        >
          {hasSavedKits ? (
            <ProfileKitsSection
              author={author}
              createdKits={[]}
              subscribedKits={savedKits}
              subscribedAuthorKits={savedAuthorKits}
              viewerHandle={viewerHandle}
              isSelf={isSelf}
            />
          ) : (
            <EmptyState>No saved kits yet. Add a kit or an author to collect them here.</EmptyState>
          )}
        </LibrarySection>

        {(isSelf || savedSkills.length > 0) && (
          <LibrarySection
            id="saved-skills"
            level="eyebrow"
            title="Skills"
            count={savedSkills.length}
            createLabel=""
          >
            {savedSkills.length > 0 ? (
              <ul className={SKILL_CARD_GRID}>
                {savedSkills.map((s) => {
                  const [sAuthor, sSlug] = s.skill_id.split(':')
                  return (
                    <li key={s.skill_id}>
                      <ProfileSkillCard
                        author={sAuthor ?? ''}
                        slug={sSlug ?? ''}
                        description={s.description ?? null}
                        category={s.category ?? null}
                        installCount={s.install_count ?? 0}
                        hideAuthor={sAuthor === author}
                      />
                    </li>
                  )
                })}
              </ul>
            ) : (
              <EmptyState>
                No saved skills yet. Add any skill to save it here and sync it to your devices.
              </EmptyState>
            )}
          </LibrarySection>
        )}
      </div>
    ) : (
      <EmptyState>
        {isSelf
          ? 'No saved skills or kits yet. Add any skill, or add a kit or author, to collect them here.'
          : 'No saved kits yet.'}
      </EmptyState>
    )

  // The shell (wash + identity band + sidebar rail) lives in the (profile)
  // layout, shared with the followers/following/installs routes so navigating
  // between them swaps only this main column. Here we render just that column.
  return (
    <>
      {/* Notices sit at the very top of the body (bottom-margin, not top) so the
          tabs/content start flush under the masthead rule. */}
      {claimResult &&
        (claimResult.classification === 'ELIGIBLE' ||
        claimResult.classification === 'ALREADY_MANAGED' ? (
          // Success: a transient toast, not a persistent bar.
          <ClaimResultToast result={claimResult} />
        ) : (
          // Denial / remediation: keep the inline notice (it carries next steps).
          <div className="mb-6">
            <ClaimResultNotice result={claimResult} />
          </div>
        ))}
      {showSaved || activity.length > 0 || showTeams ? (
        <ProfileTabs
          // One rule for the whole row: every tab counts what it holds.
          tabs={[
            {
              key: 'created',
              label: 'Created',
              count: yoursKitsCount + profile.skills.length,
            },
            ...(showSaved ? [{ key: 'saved', label: 'Saved', count: savedCount }] : []),
            ...(showTeams ? [{ key: 'teams', label: 'Teams', count: teamKitsCount }] : []),
            ...(activity.length > 0
              ? [{ key: 'activity', label: 'Activity', count: activity.length }]
              : []),
          ]}
          panels={{
            created: createdPanel,
            saved: savedPanel,
            teams: teamsPanel,
            activity: (
              <div className="profile-rail-activity max-w-[44rem]">
                <ProfileActivity events={activity} />
              </div>
            ),
          }}
          initial={tab === 'saved' ? 'saved' : tab === 'teams' && showTeams ? 'teams' : 'created'}
        />
      ) : (
        createdPanel
      )}
    </>
  )
}
