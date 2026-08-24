import { Suspense } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { SkillBundleView } from '@/components/skill-bundle-view'
import { MirrorNotice, ClaimMirrorCta } from '@/components/mirror-notice'
import { ReportDialog } from '@/components/skills/report-dialog'
import { DetailHeader } from '@/components/detail-header'
import { HeaderFollowButton } from '@/components/header-follow-button'
import { AuthorAboutRow } from '@/components/author-about-row'
import { heroWash } from '@/components/cover/hero-wash'
import { CoverArt } from '@/components/cover/cover'
import { coverHue } from '@/components/cover/cover-hue'
import { isUncategorizedSingle } from '@skillet/protocol/covers'
import { KitCard } from '@/components/kit-card'
import { SkillCard } from '@/components/skill-card'
import { Eyebrow } from '@/components/ui/eyebrow'
import { UsedBy } from '@/components/kits/used-by'
import { WorksWithRail } from '@/components/works-with-rail'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import { AddToKitButton } from '@/components/add-to-kit-button'
import { SkillDelivery } from '@/components/skills/skill-delivery'
import { TrustPanel } from '@/components/skills/trust-panel'
import { evidenceSnippet } from '@/lib/evidence-snippet'
import { fetchEvidenceFileTexts } from '@/lib/skill-bundle-evidence'
import { SkillOwnerControls } from '@/components/skills/skill-owner-controls'
import { Tooltip } from '@/components/ui/tooltip'
import { VersionHistory } from '@/components/skills/version-history'
import { DeprecatedBadge } from '@/components/deprecated-badge'
import {
  SkillInstallSkeleton,
  SkillOwnerControlsSkeleton,
} from '@/components/skills/skill-page-skeleton'
import type { SkillBundleSummary } from '@/lib/skill-bundle-content'
import type { Skill } from '@/lib/types'
import { kitHref } from '@/lib/urls'
import { timeAgo } from '@/lib/feed-format'
import { formatTokens } from '@/lib/format'
import { skillFrontmatterField } from '@/lib/skill-md-metadata'
import { CATEGORY_BY_KEY, isCategoryKey, SECTION_GLYPH_COLOR } from '@/lib/categories'
import { CategoryCover } from '@/components/cover/category-cover'
import { CategoryIcon } from '@/components/category-icons'

const numberFormat = new Intl.NumberFormat('en-US')

function MetaDot() {
  return (
    <span aria-hidden="true" className="opacity-40">
      ·
    </span>
  )
}

/** About-rail row: the shared 20px icon gutter + text, so every line's text
 *  starts on the same left edge ({@link MirrorNotice} draws the same grid). */
function AboutRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] items-start gap-x-2.5">
      <span className="inline-flex h-5 w-5 items-center justify-center">{icon}</span>
      <span className="min-w-0 leading-5">{children}</span>
    </span>
  )
}

/** Tiny © for an author-declared license line. */
function LicenseGlyph() {
  return (
    <span aria-hidden="true" className="text-sm leading-none text-(--ink-2)">
      ©
    </span>
  )
}

/** A small bar meter — the token count is a context-weight/cost reading. */
function TokenGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4 text-(--ink-2)"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="2.5" y="9" width="2.6" height="4.5" rx="1" opacity="0.45" />
      <rect x="6.7" y="6" width="2.6" height="7.5" rx="1" opacity="0.7" />
      <rect x="10.9" y="3" width="2.6" height="10.5" rx="1" />
    </svg>
  )
}

/** A tag — for the version row. */
function VersionGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4 text-(--ink-2)"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 7.6V3.4a.9.9 0 0 1 .9-.9h4.2a.9.9 0 0 1 .64.26l5 5a.9.9 0 0 1 0 1.28l-4.2 4.2a.9.9 0 0 1-1.28 0l-5-5A.9.9 0 0 1 2.5 7.6Z" />
      <circle cx="5.4" cy="5.4" r="0.85" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** A clock — for the updated row. */
function UpdatedGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4 text-(--ink-2)"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.3" />
    </svg>
  )
}

/** A kit as the sidebar rail renders it (KitCard props). */
type RailKit = {
  id: string
  owner: string
  slug: string
  name: string
  skillCount: number
  skillRefs?: string[]
  skillCategories?: (string | null)[]
  category?: string | null
}

/** A skill as the rail's discovery fallback renders it (SkillCard props). */
type RailSkill = {
  author: string
  slug: string
  title?: string | null
  category?: string | null
  installCount?: number
}

export async function SkillPageView({
  author,
  slug,
  skill,
  bundle,
  publicKits,
  popularSkills = [],
  authorProfile,
}: {
  author: string
  slug: string
  skill: Skill
  bundle: SkillBundleSummary | null
  publicKits: RailKit[]
  /** Discovery fallback for the rail: when this skill has no used-by, kits, or
   *  sibling skills to show, the rail fills with popular skills instead of going
   *  blank. Empty/omitted is fine — the fallback section just won't render. */
  popularSkills?: RailSkill[]
  authorProfile: {
    /** Full name for the rail's author row; falls back to the handle. */
    displayName?: string | null
    avatarUrl?: string | null
    /** Team owners render the byline avatar as a monogram, never a person face. */
    kind?: 'user' | 'team'
    skills?: Array<{ slug: string; title: string; category?: string | null; installCount?: number }>
  } | null
}) {
  const ref = `@${author}/${slug}`
  // A moderator-quarantined skill has its downloads blocked at the registry, so
  // the page must surface the block instead of an install path that 403s.
  const quarantined = skill.moderationStatus === 'quarantined'
  // The scanner blocks downloads the same way a moderator does, but leaves
  // moderationStatus untouched — so a skill whose every version was held reads
  // as unmoderated while serving nothing. `latest_hash` is null in that case;
  // it is the only signal that survives, because scanStatus is itself derived
  // from the version that does not exist. Treat it as blocked for every
  // install affordance, or the page offers a command that 403s.
  const noServableVersion = skill.hasInstallableVersion === false
  const blocked = quarantined || noServableVersion
  const sec = skill.security
  const usedBy = skill.usedByPeople ?? []
  const hasUsedBy = (skill.usedByCount ?? 0) > 0 || usedBy.length > 0
  // Social proof, defined once: it leads the rail on desktop, but on mobile the
  // rail stacks to the very bottom — so we surface this copy right under the hero.
  const usedByBlock = (
    <UsedBy
      layout="stacked"
      kind="skill"
      id={ref}
      initial={skill.usedByCount ?? 0}
      faces={usedBy.map((p) => ({
        handle: p.handle,
        name: p.name || p.handle,
        avatarUrl: p.avatarUrl ?? null,
      }))}
    />
  )
  const moreFromAuthor = (authorProfile?.skills ?? []).filter((s) => s.slug !== slug).slice(0, 4)
  // A new or solo skill (no installs, no kits, no sibling skills) would leave the
  // rail blank — fill it with popular skills so it stays a discovery surface.
  const railEmpty = !hasUsedBy && publicKits.length === 0 && moreFromAuthor.length === 0
  const fallbackSkills = railEmpty
    ? popularSkills.filter((s) => !(s.author === author && s.slug === slug)).slice(0, 4)
    : []
  const hasMinorTrust = skill.evalStatus === 'passed' || skill.signatureStatus === 'verified'
  const hasTrust =
    (!!sec && sec.status !== 'pending') || hasMinorTrust || !!skill.isMirror || !!skill.githubSynced
  // Capabilities load for every analyzed skill (clean ones included), so an array
  // — even empty — means show the panel (empty drives "No capabilities detected").
  const hasCapabilities = Array.isArray(skill.capabilities)
  // About-rail facts: provenance and license are identity facts, not
  // capabilities — they live in the sidebar's About block, not the trust panel.
  const isFromGitHub = !!(skill.isMirror || skill.githubSynced)
  // Author-declared license for a native skill: the optional SPDX `license:`
  // frontmatter field (docs/skill-md). Never defaulted. Length-capped so a
  // stray paragraph in frontmatter can't blow up the strip.
  const declaredLicense = isFromGitHub
    ? null
    : skillFrontmatterField(bundle?.frontmatter ?? null, 'license')?.slice(0, 32) ?? null
  const cat = isCategoryKey(skill.category) ? CATEGORY_BY_KEY[skill.category] : null
  // Relative freshness for the hero byline, matching the kit hero (timeAgo wants
  // unix seconds; version publishedAt is an ISO string).
  const publishedSec = skill.versions[0]?.publishedAt
    ? Math.floor(new Date(skill.versions[0].publishedAt).getTime() / 1000)
    : NaN
  const updatedLabel = Number.isFinite(publishedSec)
    ? `Updated ${timeAgo(publishedSec, { suffix: true })}`
    : undefined
  // Approx context cost for the quiet About rail (not the hero — it is
  // informational, not a decision the reader acts on in v1). The tilde carries
  // the approximation; the accessible name says "approximate" so a screen reader
  // never announces it as an exact count. Rendered only when backfilled.
  const tokenCost =
    typeof skill.tokenCount === 'number' && skill.tokenCount > 0
      ? {
          label: `${formatTokens(skill.tokenCount)} tokens`,
          aria: `approximately ${numberFormat.format(skill.tokenCount)} tokens, cross-vendor estimate`,
          full: formatTokens(skill.tokenCount),
          // The insight is the split: only the ambient portion (name + trigger)
          // is always in context; the full body loads when the skill runs.
          ambient:
            typeof skill.tokenAmbient === 'number' && skill.tokenAmbient > 0
              ? formatTokens(skill.tokenAmbient)
              : null,
        }
      : undefined
  // Resolve each evidence location's flagged lines from targeted per-file fetches
  // on the server, so the trust panel prints the actual source without embedding
  // the whole bundle in the RSC payload.
  const evidencePaths = [
    ...(skill.capabilities?.flatMap((c) => c.evidence.map((e) => e.file)) ?? []),
    ...(sec?.findings.map((f) => f.file) ?? []),
  ]
  const fileText =
    bundle?.versionHash != null
      ? await fetchEvidenceFileTexts(author, slug, bundle.versionHash, evidencePaths, {
          withSession: skill.visibility === 'private',
        })
      : new Map<string, string>()
  const capabilities = skill.capabilities?.map((c) => ({
    ...c,
    evidence: c.evidence.map((e) => ({
      ...e,
      snippet: evidenceSnippet(fileText.get(e.file), e.lineStart, e.lineEnd) ?? e.snippet,
    })),
  }))
  const secFindings = sec?.findings.map((f) => ({
    ...f,
    snippet: evidenceSnippet(fileText.get(f.file), f.line ?? 1, f.line ?? 1) ?? f.snippet,
  }))

  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{
          background: heroWash(
            `${author}/${slug}`,
            coverHue([skill.category], `${author}/${slug}`),
            isUncategorizedSingle([skill.category]) ? 10 : undefined,
          ),
        }}
      />
      <main className={`relative ${PAGE_CONTAINER_CLASS}`}>
        {/* Two columns: a left rail (cover on top of the meta) and the main
            column with identity, actions, and the skill body. */}
        <div className="mt-3 grid gap-10 lg:grid-cols-[var(--rail-nav)_minmax(0,1fr)] lg:items-start">
          {/* MAIN column — identity + actions, then the skill body. The rail is
              ordered before it (lg:order-first) so the cover + meta sit left. */}
          <div className="min-w-0 lg:mt-2 [&>*:first-child]:mt-0">
            <DetailHeader
              kind="skill"
              title={skill.title}
              owner={author}
              description={skill.description}
              // Attribution stays on the byline: who made this, before the
              // thing is even named. The rail's About row is the identity card
              // (avatar, full name, Follow) and owns the only follow control,
              // so the two say different things rather than saying it twice.
              isPrivate={skill.visibility === 'private'}
              badges={
                skill.deprecated || blocked ? (
                  <>
                    {quarantined && <Badge variant="danger">quarantined</Badge>}
                    {noServableVersion && !quarantined && (
                      <Badge variant="danger">unavailable</Badge>
                    )}
                    {skill.deprecated && <DeprecatedBadge />}
                  </>
                ) : undefined
              }
              action={
                <div className="flex flex-wrap items-center gap-2">
                  {!(skill.deprecated || blocked) && (
                    <Suspense fallback={<SkillInstallSkeleton />}>
                      <AddToKitButton refName={ref} />
                    </Suspense>
                  )}
                  <Suspense fallback={null}>
                    <SkillOwnerControls author={author} slug={slug} placement="hero" />
                  </Suspense>
                </div>
              }
            />
            {/* What follows Add, exactly as on a kit page. Its own boundary, and
                a null fallback: the bar has nothing to say until Add is pressed,
                so it can stream in rather than holding up the header. */}
            {!(skill.deprecated || blocked) && (
              <Suspense fallback={null}>
                <SkillDelivery author={author} slug={slug} />
              </Suspense>
            )}
            {/* Mobile only — keeps social proof near the top instead of buried at
                the bottom when the rail stacks under the content. */}
            {hasUsedBy && <div className="mt-8 lg:hidden">{usedByBlock}</div>}

            {skill.triggers && skill.triggers.length > 0 && (
              <div className="mt-8 max-w-[68ch]">
                <Eyebrow>Use when</Eyebrow>
                <ul className="mt-2 space-y-1.5 text-base leading-[1.5] text-(--ink-2)">
                  {skill.triggers.map((trigger) => (
                    <li key={trigger} className="flex gap-2">
                      <span className="text-(--accent)" aria-hidden="true">
                        ·
                      </span>
                      <span>{trigger}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {noServableVersion && !quarantined && (
              <div className="mt-6 rounded-xl border border-(--danger-line) bg-(--danger-bg) px-4 py-3">
                <p className="text-sm font-medium leading-[1.5] text-(--danger)">
                  Not available to install.
                </p>
                <p className="mt-1 text-sm leading-[1.5] text-(--ink-2)">
                  Every published version was held by our security scanner, so there is no
                  version to serve. Nothing here was reviewed by a moderator.
                </p>
              </div>
            )}

            {quarantined && (
              <div className="mt-6 rounded-xl border border-(--danger-line) bg-(--danger-bg) px-4 py-3">
                <p className="text-sm font-medium leading-[1.5] text-(--danger)">
                  Quarantined by a moderator.
                </p>
                <p className="mt-1 text-sm leading-[1.5] text-(--ink-2)">
                  Downloads are blocked while this skill is under review. The install command
                  won&rsquo;t work.
                </p>
              </div>
            )}

            {skill.deprecated && (
              <div className="mt-6 rounded-xl border border-(--caution)/40 bg-(--caution)/10 px-4 py-3">
                <p className="text-sm leading-[1.5] text-(--ink)">
                  This skill is deprecated. It&rsquo;s hidden from the directory and no one else
                  can open it, so only you see this page.
                </p>
                {skill.deprecationMessage?.trim() && (
                  <p className="mt-2 text-sm leading-[1.5] text-(--ink-2)">
                    {skill.deprecationMessage}
                  </p>
                )}
              </div>
            )}

            {(hasTrust || bundle || hasCapabilities) && (
              <div className="mt-8">
                {(() => {
                  const minor = hasMinorTrust && (
                    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm text-(--ink-2)">
                      {skill.evalStatus === 'passed' && (
                        <span
                          title="Passed Skillet's static basic eval (evals/smoke.json)."
                          className="text-(--success)"
                        >
                          basic eval
                        </span>
                      )}
                      {skill.evalStatus === 'passed' && skill.signatureStatus === 'verified' && (
                        <MetaDot />
                      )}
                      {skill.signatureStatus === 'verified' && (
                        <span title="Author Ed25519 signature matches the published key.">
                          signed
                        </span>
                      )}
                    </span>
                  )
                  const source = minor ? (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                      {minor}
                    </span>
                  ) : undefined

                  // Threat findings are merged only for flagged/quarantined skills;
                  // pending is gated upstream so it never reaches the panel.
                  const findings = sec && sec.status !== 'pending' ? secFindings : undefined
                  // The unified trust panel renders when there's a capability manifest
                  // or any findings; otherwise just the minor-trust line.
                  const showPanel = hasCapabilities || (findings?.length ?? 0) > 0
                  return showPanel ? (
                    <div className="mb-3">
                      <TrustPanel
                        capabilities={capabilities}
                        analysis={skill.capabilitiesAnalysis}
                        findings={findings}
                        blindSpots={skill.capabilitiesBlindSpots}
                        status={sec && sec.status !== 'pending' ? sec.status : undefined}
                        source={source}
                      />
                    </div>
                  ) : source ? (
                    <div className="mb-3">{source}</div>
                  ) : null
                })()}

                {bundle && (
                  <div className="mt-8">
                    <Eyebrow>Files</Eyebrow>
                    <div className="mt-3">
                      <SkillBundleView bundle={bundle} author={author} slug={slug} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* The install path used to sit here as a quiet panel handing over
                one copy command. It moved under Add, where the kit page already
                puts it: install is the second half of adding, not a separate
                route buried past the content, and the panel never mentioned the
                two surfaces that need no install at all. */}

            <div className="mt-8 space-y-6">
              {skill.versions.length > 0 && (
                <VersionHistory
                  versions={skill.versions}
                  author={author}
                  slug={slug}
                  upstreamHeld={skill.mirrorUpstreamBlocked}
                  noneServable={noServableVersion}
                  sourceUrl={skill.mirrorSourceUrl}
                />
              )}
            </div>

            {/* Claim CTA (mirrors only) is the sole page-foot row now; reporting
                moved to the sidebar under "Works with". */}
            {skill.isMirror && (
              <div className="mt-12 border-t border-(--line) pt-5 text-sm text-(--ink-2)">
                <ClaimMirrorCta handle={author} />
              </div>
            )}
          </div>

          <aside className="lg:order-first lg:sticky lg:top-24">
            {/* The cover leads the left rail, above the About block. */}
            <div className="mb-6 relative aspect-square w-full overflow-hidden rounded-2xl shadow-sm ring-1 ring-black/5">
              {isCategoryKey(skill.category) ? (
                <CategoryCover
                  category={skill.category}
                  seed={`${author}/${slug}`}
                  className="relative h-full w-full"
                />
              ) : (
                <CoverArt
                  seed={`${author}/${slug}`}
                  categories={[skill.category ?? null]}
                  listMark
                  className="h-full w-full"
                />
              )}
            </div>

            {/* Owner/contributor controls lead the rail — Manage (owner) or
                Propose (contributor) sits up with the object, not buried at the
                foot of the content column. Renders nothing for everyone else. */}
            <Suspense fallback={<SkillOwnerControlsSkeleton />}>
              <SkillOwnerControls author={author} slug={slug} placement="rail" />
            </Suspense>

            {/* About — the add-decision facts (what kind, where from, runs
                where), stacked GitHub-About style at the top of the rail.
                Every row leads with the same 20px icon gutter (AboutRow /
                MirrorNotice share the geometry) so the text edges align. */}
            <section className="py-4 first:pt-0">
              <Eyebrow>About</Eyebrow>
              <div className="mt-3 flex flex-col items-stretch gap-2.5 text-sm text-(--ink-2)">
                {/* The author leads. Who made this is not the same class of
                    thing as a token count, and the order says so. Provenance
                    follows, which for a mirror is the next strongest identity
                    fact in the block. */}
                <AuthorAboutRow
                  handle={author}
                  displayName={authorProfile?.displayName}
                  avatarUrl={authorProfile?.avatarUrl ?? null}
                  isTeam={authorProfile?.kind === 'team'}
                  follow={<HeaderFollowButton owner={author} appearance="inline" />}
                />
                {isFromGitHub && (
                  <MirrorNotice
                    sourceUrl={skill.mirrorSourceUrl}
                    license={skill.mirrorLicense}
                    live={skill.githubSyncedLive ?? skill.isMirror ?? false}
                  />
                )}
                {cat && (
                  <AboutRow
                    icon={
                      <span
                        className="text-base"
                        style={{ color: SECTION_GLYPH_COLOR[cat.section] }}
                      >
                        <CategoryIcon cat={cat.key} />
                      </span>
                    }
                  >
                    <Link
                      href={`/browse/${cat.key}`}
                      className="transition-colors hover:text-(--ink)"
                    >
                      {cat.label}
                    </Link>
                  </AboutRow>
                )}
                {declaredLicense && (
                  <AboutRow icon={<LicenseGlyph />}>
                    <span title="Declared by the author in SKILL.md frontmatter">
                      {declaredLicense} license
                    </span>
                  </AboutRow>
                )}
                {tokenCost && (
                  <AboutRow icon={<TokenGlyph />}>
                    <Tooltip
                      content={
                        <div className="w-52">
                          <p className="font-medium text-(--ink)">Context cost</p>
                          <dl className="mt-2 space-y-1.5">
                            {tokenCost.ambient && (
                              <div className="flex items-baseline justify-between gap-6">
                                <dt className="text-(--ink-2)">Always loaded</dt>
                                <dd className="font-mono text-(--ink)">{tokenCost.ambient}</dd>
                              </div>
                            )}
                            <div className="flex items-baseline justify-between gap-6">
                              <dt className="text-(--ink-2)">When it runs</dt>
                              <dd className="font-mono text-(--ink)">{tokenCost.full}</dd>
                            </div>
                          </dl>
                          <p className="mt-2.5 border-t border-(--line) pt-2 text-xs text-(--ink-2)">
                            {tokenCost.ambient
                              ? 'Only the name and trigger stay loaded so your agent knows it exists. The rest loads when it runs.'
                              : 'What the skill adds to your agent’s context when it loads.'}
                          </p>
                        </div>
                      }
                    >
                      <span
                        aria-label={tokenCost.aria}
                        className="cursor-help underline decoration-dotted decoration-(--ink-2)/40 underline-offset-2"
                      >
                        {tokenCost.label}
                      </span>
                    </Tooltip>
                  </AboutRow>
                )}
                <AboutRow icon={<VersionGlyph />}>
                  <span className="font-mono">{skill.latestVersion}</span>
                </AboutRow>
                {updatedLabel && (
                  <AboutRow icon={<UpdatedGlyph />}>{updatedLabel}</AboutRow>
                )}
                {/* Runtime reach + version/freshness now lead the hero (beside the
                    cover), so the rail keeps only the quieter identity facts. */}
              </div>
            </section>

            {/* Desktop only — on mobile this lives up under the hero (below).
                The wrapper makes the inner section a first-child, so restore its
                top padding to keep the About→Used-by gap equal to every other
                section-to-section gap in the rail. */}
            {hasUsedBy && (
              <div className="hidden [&>section]:!pt-4 lg:block">{usedByBlock}</div>
            )}

            {publicKits.length > 0 && (
              <section className="py-4 first:pt-0">
                <Eyebrow>In these kits</Eyebrow>
                <ul className="mt-2">
                  {publicKits.map((kit) => (
                    <KitCard
                      key={kit.id}
                      kitId={kit.id}
                      size="sm"
                      href={kitHref(kit.owner, kit.slug)}
                      name={kit.name}
                      owner={kit.owner}
                      skillCount={kit.skillCount}
                      skillRefs={kit.skillRefs ?? []}
                      skillCategories={kit.skillCategories ?? []}
                      category={kit.category}
                    />
                  ))}
                </ul>
              </section>
            )}

            {moreFromAuthor.length > 0 && (
              <section className="py-4 first:pt-0">
                <Eyebrow>More from @{author}</Eyebrow>
                <ul className="mt-2">
                  {moreFromAuthor.map((s) => (
                    <SkillCard
                      key={s.slug}
                      size="sm"
                      author={author}
                      slug={s.slug}
                      title={s.title}
                      category={s.category}
                      installCount={s.installCount}
                    />
                  ))}
                </ul>
              </section>
            )}

            {/* Discovery fallback — keeps the rail useful for a skill with no
                social proof / kits / siblings of its own, instead of going blank. */}
            {fallbackSkills.length > 0 && (
              <section className="py-4 first:pt-0">
                <Eyebrow>Popular skills</Eyebrow>
                <ul className="mt-2">
                  {fallbackSkills.map((s) => (
                    <SkillCard
                      key={`${s.author}/${s.slug}`}
                      size="sm"
                      author={s.author}
                      slug={s.slug}
                      title={s.title}
                      category={s.category}
                      installCount={s.installCount}
                    />
                  ))}
                </ul>
              </section>
            )}

            {/* Runtime reach, then a quiet report line ends the rail. */}
            <WorksWithRail />

            <div className="mt-4 border-t border-(--line) pt-4 text-sm leading-[1.5]">
              <ReportDialog author={author} slug={slug} label="Report this skill" />
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
