import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { auth } from '@/auth'
import { readSessionCookie } from '@/lib/session-cookie'
import { fetchMcpLink } from '@/lib/mcp-link'
import { getKitByHandle, getKitCapabilities, getKitVersions, getRelatedKits } from '@/lib/kits-server'
import { getAuthorProfile } from '@/lib/registry'
import { KitCard, KitRow } from '@/components/kit-card'
import { SkillCard } from '@/components/skill-card'
import { KitActionRow } from '@/components/kits/kit-action-row'
import { TeamKitSyncButton } from '@/components/team/team-kit-sync-button'
import { listMyOrgs, getMutedTeamKitIds } from '@/lib/orgs-server'
import { viewerOrgRole } from '@/lib/orgs'
import { HeaderFollowButton } from '@/components/header-follow-button'
import { AuthorAboutRow } from '@/components/author-about-row'
import { KitPageLayout } from '@/components/kits/kit-page-layout'
import { kitInstallCommand } from '@/lib/cli-install-commands'
import { Button } from '@/components/ui/button'
import { Eyebrow } from '@/components/ui/eyebrow'
import { UsedBy } from '@/components/kits/used-by'
import { usedByFacesFromWire } from '@/lib/used-by'
import { DynamicPageBoundary } from '@/lib/dynamic-page-boundary'
import { kitHref, kitEditHref } from '@/lib/urls'
import { formatShortDate } from '@/lib/feed-format'
import { ogImagePath, OG } from '@/lib/og'

interface Params {
  author: string
  slug: string
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { author, slug } = await params
  const result = await getKitByHandle(author, slug)
  if (result.kind !== 'ok') return {}
  const kit = result.kit
  const ogUrl = ogImagePath(
    OG.kit({
      name: kit.name,
      seed: kit.id,
      handle: kit.owner,
      count: kit.skills.length,
      subscribers: kit.subscriber_count,
      cats: kit.skills.map((s) => s.category ?? null),
    }),
  )
  return {
    title: `${kit.name} by @${kit.owner} · Skillet`,
    description:
      kit.description ?? `A curated kit of ${kit.skills.length} skills by @${kit.owner}.`,
    openGraph: {
      title: kit.name,
      description: kit.description ?? 'A curated set of skills.',
      type: 'website',
      images: [{ url: ogUrl, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', images: [ogUrl] },
  }
}

/** The viewer's MCP link, or null when off, unauthenticated, or unavailable.
 *  Never throws: the Chat door degrades to "turn it on" rather than the page
 *  failing over a connector lookup. */
async function viewerMcpLink() {
  const token = readSessionCookie(await cookies())
  if (!token) return null
  return fetchMcpLink(token).catch(() => null)
}

export async function KitPageContent({ params }: { params: Promise<Params> }) {
  const { author, slug } = await params
  const [session, result] = await Promise.all([auth(), getKitByHandle(author, slug)])
  if (result.kind !== 'ok') notFound()
  const kit = result.kit

  // A stale rename alias resolves to the kit but isn't canonical — send the
  // reader to the current permalink.
  if (kit.slug !== slug || kit.owner !== author) {
    redirect(kitHref(kit.owner, kit.slug))
  }

  // The auto "Saved" kit is a hidden system bucket, not a browsable or
  // manageable kit. Its skills live on the profile's Saved tab, so send anyone
  // who lands here (or follows the Updates "Saved" group) there instead.
  if (kit.kind === 'saved') {
    redirect(`/${kit.owner}?tab=saved#saved-skills`)
  }

  const [
    versionsResult,
    ownerProfile,
    relatedResult,
    kitCapabilities,
    myOrgs,
    mutedKitIds,
    // Whether install still has anything to say to this viewer. Same signal the
    // profile header reads for its connect nudge; per-account, not per-machine,
    // which is why the connected state keeps a path for an unpaired laptop.
    // In the batch, not after it: awaiting it separately cost every signed-in
    // reader an extra serial round trip.
    viewerProfile,
    mcpLink,
  ] = await Promise.all([
    getKitVersions(kit.id),
    getAuthorProfile(kit.owner).catch(() => null),
    getRelatedKits(kit.id),
    getKitCapabilities(kit.skills).catch(() => null),
    session?.handle ? listMyOrgs() : Promise.resolve({ kind: 'unauthorized' as const }),
    session?.handle ? getMutedTeamKitIds() : Promise.resolve(new Set<string>()),
    session?.handle ? getAuthorProfile(session.handle).catch(() => null) : Promise.resolve(null),
    // MCP state for the Chat door: whether a link already exists decides between
    // "turn it on" and "here it is". Same source Settings reads.
    session?.handle ? viewerMcpLink() : Promise.resolve(null),
  ])

  const mcpUrl = mcpLink?.ok && mcpLink.enabled ? mcpLink.link.url : null

  const viewerRuntimes = (
    viewerProfile?.runtimes?.map((r) => r.key) ?? viewerProfile?.detectedRuntimes ?? []
  ).filter(Boolean)

  const viewerHandle = session?.handle ?? null
  const isOwner = viewerHandle === kit.owner
  // A member of the owning team already gets this kit via membership (it syncs to
  // their agents). So the hero isn't "Add" — it's a Remove/Add that mutes/unmutes
  // the team kit, matching the Teams tab. Owners keep Manage.
  const isTeamMember = !isOwner && viewerOrgRole(myOrgs, kit.owner) != null
  const versions = versionsResult.kind === 'ok' ? versionsResult.versions : []
  const updatedAt = kit.last_updated ?? versions[0]?.created_at ?? undefined

  const moreKitsFromOwner = (ownerProfile?.kits ?? [])
    .filter((k) => k.id !== kit.id && k.visibility !== 'private')
    .slice(0, 3)
  const inKitOwnerSlugs = new Set(
    kit.skills
      .map((e) => e.skill_id.split(':'))
      .filter(([entryAuthor]) => entryAuthor === kit.owner)
      .map(([, entrySlug]) => entrySlug),
  )
  const moreSkillsFromOwner = (ownerProfile?.skills ?? [])
    .filter((s) => !inKitOwnerSlugs.has(s.slug))
    .slice(0, 3)
  const hasMoreFromOwner = moreKitsFromOwner.length > 0 || moreSkillsFromOwner.length > 0

  const viewerFace =
    kit.subscribed && viewerHandle
      ? {
          handle: viewerHandle,
          name: session?.user?.name ?? viewerHandle,
          avatarUrl: session?.user?.image ?? null,
        }
      : null
  const usedByFaces = [
    ...(viewerFace ? [viewerFace] : []),
    ...usedByFacesFromWire(kit.subscribed_by_you).filter((f) => f.handle !== viewerHandle),
  ]
  const ownerKitIds = new Set(moreKitsFromOwner.map((k) => k.id))
  const relatedKits = (relatedResult.kind === 'ok' ? relatedResult.kits : []).filter(
    (k) => !ownerKitIds.has(k.id),
  )
  const hasUsedBy = (kit.subscriber_count ?? 0) > 0 || usedByFaces.length > 0

  return (
    <KitPageLayout
      kitId={kit.id}
      name={kit.name}
      owner={kit.owner}
      ownerAvatar={ownerProfile?.avatarUrl ?? null}
      ownerIsTeam={ownerProfile?.kind === 'team'}
      description={kit.description}
      updatedAt={updatedAt}
      skillCount={kit.skills.length}
      categories={kit.skills.map((s) => s.category ?? null)}
      isPrivate={kit.visibility === 'private'}
      heroSeed={kit.id}
      skills={kit.skills}
      capabilities={kitCapabilities}
      action={
        isOwner ? (
          <Button href={kitEditHref(kit.owner, kit.slug)} variant="secondary" size="lg">
            Manage kit
          </Button>
        ) : isTeamMember ? (
          <TeamKitSyncButton kitId={kit.id} initialMuted={mutedKitIds.has(kit.id)} />
        ) : (
          // One client boundary. The bar under these buttons has to know which
          // one you just pressed, and the server's initial `subscribed` can only
          // describe how the page arrived.
          <KitActionRow
            kitId={kit.id}
            owner={kit.owner}
            initialSubscribed={!!kit.subscribed}
            viewerHandle={viewerHandle}
            runtimes={viewerRuntimes}
            mcpUrl={mcpUrl}
          />
        )
      }
      authorRow={
        <AuthorAboutRow
          handle={kit.owner}
          displayName={ownerProfile?.displayName}
          avatarUrl={ownerProfile?.avatarUrl ?? null}
          isTeam={ownerProfile?.kind === 'team'}
          follow={
            isOwner ? null : (
              <HeaderFollowButton
                owner={kit.owner}
                isTeam={ownerProfile?.kind === 'team'}
                appearance="inline"
              />
            )
          }
        />
      }
      mainExtra={
        <>

          {versions.length > 0 && (
            <section>
              <Eyebrow>Version history</Eyebrow>
              <ul className="mt-3 divide-y divide-(--line)">
                {versions.map((v) => (
                  <li key={v.version} className="py-3 first:pt-0">
                    <div className="flex items-start gap-3">
                      <span className="min-w-0 flex-1 break-all font-mono text-sm text-(--ink)">
                        v{v.version}
                      </span>
                      <span className="shrink-0 font-mono text-xs text-(--ink-2)">
                        {formatShortDate(v.created_at)}
                      </span>
                    </div>
                    {v.summary && (
                      <p className="mt-1 text-sm leading-[1.5] text-(--ink-2)">{v.summary}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      }
      railExtra={
        <>
          {/* Membership context in the rail, mirroring the team profile's
              "You're a member of this team" — explains why a member can see this
              private kit. State-agnostic; the hero button carries added/removed. */}
          {isTeamMember && (
            <section className="py-4 first:pt-0">
              <Eyebrow>Team</Eyebrow>
              <p className="mt-2 text-sm leading-relaxed text-(--ink-2)">
                You’re a member of @{kit.owner}.
              </p>
            </section>
          )}

          {hasMoreFromOwner && (
            <section className="py-4 first:pt-0">
              <Eyebrow>More from @{kit.owner}</Eyebrow>
              <ul className="mt-2">
                {moreKitsFromOwner.map((k) => (
                  <KitCard
                    key={k.id}
                    kitId={k.id}
                    size="sm"
                    href={kitHref(k.owner ?? kit.owner, k.slug ?? '')}
                    name={k.name}
                    owner={k.owner ?? kit.owner}
                    skillCount={k.skillCount}
                    skillRefs={k.skillRefs ?? []}
                    skillCategories={k.skillCategories ?? []}
                    category={k.category}
                  />
                ))}
                {moreSkillsFromOwner.map((s) => (
                  <SkillCard
                    key={s.slug}
                    size="sm"
                    author={kit.owner}
                    slug={s.slug}
                    title={s.title}
                    category={s.category}
                    installCount={s.installCount}
                  />
                ))}
              </ul>
            </section>
          )}

          {relatedKits.length > 0 && (
            <section className="py-4 first:pt-0">
              <Eyebrow>People also added</Eyebrow>
              <ul className="mt-2">
                {relatedKits.slice(0, 3).map((k) => (
                  <KitRow
                    key={k.id}
                    kitId={k.id}
                    href={kitHref(k.owner ?? '', k.slug ?? '')}
                    name={k.name}
                    owner={k.owner ?? ''}
                    skillRefs={k.skill_refs ?? []}
                    skillCategories={k.skill_categories ?? []}
                  />
                ))}
              </ul>
            </section>
          )}
        </>
      }
    />
  )
}

export default function KitPage(props: { params: Promise<Params> }) {
  return (
    <DynamicPageBoundary>
      <KitPageContent {...props} />
    </DynamicPageBoundary>
  )
}
