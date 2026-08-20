import { type ReactNode } from 'react'
import Link from 'next/link'
import { DetailHeader } from '@/components/detail-header'
import { KitSkillList } from '@/components/kits/kit-skill-list'
import { TrustPanel } from '@/components/skills/trust-panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { WorksWithRail } from '@/components/works-with-rail'
import { heroWash } from '@/components/cover/hero-wash'
import { coverHue } from '@/components/cover/cover-hue'
import { PaintedCover } from '@/components/cover/painted-cover'
import { kitCoverCategories } from '@/components/directory-card'
import { timeAgo } from '@/lib/feed-format'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'
import type { KitSkillEntry } from '@/lib/kits'
import type { SkillCapabilityReport } from '@/lib/types'

/** The capability union the kit's TrustPanel renders (aggregate mode), or null
 *  when no scan is available. */
type KitCapabilities = SkillCapabilityReport | null

/** About-rail row — same 20px icon gutter as the skill page so the rails match. */
function AboutRow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] items-start gap-x-2.5">
      <span className="inline-flex h-5 w-5 items-center justify-center">{icon}</span>
      <span className="min-w-0 leading-5">{children}</span>
    </span>
  )
}

/** A small stack — for the skill-count row. */
function SkillsGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 text-(--ink-2)" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.2 14 5 8 7.8 2 5Z" />
      <path d="M2 8l6 2.8L14 8" />
      <path d="M2 11l6 2.8L14 11" />
    </svg>
  )
}

/** A clock — for the updated row. */
function UpdatedGlyph() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4 text-(--ink-2)" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3l2 1.3" />
    </svg>
  )
}

/**
 * The ONE kit-page shell, shared by the named kit (/[author]/kit/[slug]) and
 * the virtual author-kit (/[author]/kit). Owns the whole layout — hero wash,
 * cover-forward hero, and the two-column body (capabilities → skills on the
 * left, social proof + discovery on the right) — so the two surfaces can't
 * drift: change the layout here, both update. Each route supplies only what
 * differs (cover, primary action, and the optional extras below/beside).
 */
export function KitPageLayout({
  // Hero
  kitId,
  name,
  owner,
  ownerAvatar,
  ownerIsTeam,
  description,
  updatedAt,
  skillCount,
  categories,
  coverNode,
  hideByline,
  isPrivate,
  action,
  follow,
  // Body
  heroSeed,
  skills,
  capabilities,
  usedByBlock,
  /** Extra sections in the main column, below the skill list (a named kit's
   *  install command + version history; empty for the virtual author-kit). */
  mainExtra,
  /** Extra rail sections above the shared "Make your own" (more-from-owner +
   *  people-also-added on a named kit; empty on the author-kit). */
  railExtra,
}: {
  kitId: string
  name: string
  owner: string
  ownerAvatar: string | null
  ownerIsTeam?: boolean
  description: string | null
  updatedAt?: number | null
  skillCount: number
  categories: (string | null)[]
  coverNode?: ReactNode
  hideByline?: boolean
  isPrivate?: boolean
  action?: ReactNode
  follow?: ReactNode
  heroSeed: string
  skills: KitSkillEntry[]
  capabilities: KitCapabilities
  usedByBlock?: ReactNode
  mainExtra?: ReactNode
  railExtra?: ReactNode
}) {
  return (
    <div className="relative">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80"
        style={{ background: heroWash(heroSeed, coverHue(categories, heroSeed)) }}
      />
      <main className={`relative ${PAGE_CONTAINER_CLASS}`}>
        {/* Same shape as the skill page: cover on top of the left rail, identity
            + actions + body in the main column. */}
        <div className="mt-3 grid gap-10 lg:grid-cols-[var(--rail-nav)_minmax(0,1fr)] lg:items-start">
          {/* LEFT rail — cover, then About, then discovery + runtime reach. */}
          <aside className="lg:order-first lg:sticky lg:top-24">
            <div className="mb-6 relative aspect-square w-full overflow-hidden rounded-2xl shadow-sm ring-1 ring-black/5">
              {coverNode ?? (
                <PaintedCover
                  seed={kitId}
                  categories={kitCoverCategories(categories, null, categories.length, kitId)}
                />
              )}
            </div>

            <section className="py-4 first:pt-0">
              <Eyebrow>About</Eyebrow>
              <div className="mt-3 flex flex-col items-stretch gap-2.5 text-sm text-(--ink-2)">
                <AboutRow icon={<SkillsGlyph />}>
                  {skillCount} {skillCount === 1 ? 'skill' : 'skills'}
                </AboutRow>
                {updatedAt != null && (
                  <AboutRow icon={<UpdatedGlyph />}>
                    Updated {timeAgo(updatedAt, { suffix: true })}
                  </AboutRow>
                )}
              </div>
            </section>

            {usedByBlock && <div className="hidden lg:block">{usedByBlock}</div>}

            {railExtra}

            <WorksWithRail />

            <section className="py-4 first:pt-0">
              <Eyebrow>Make your own</Eyebrow>
              <p className="mt-2 text-sm leading-relaxed text-(--ink-2)">
                Bundle your favorite skills into a kit to share or deploy.
              </p>
              <Link
                href="/kits/new"
                className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-(--accent) hover:underline"
              >
                Create a kit
              </Link>
            </section>
          </aside>

          {/* MAIN — KIT BY @owner identity + actions, then the kit body. */}
          <div className="min-w-0 lg:mt-2 [&>*:first-child]:mt-0">
            <DetailHeader
              kind="kit"
              title={name}
              owner={owner}
              ownerAvatarUrl={ownerAvatar}
              ownerIsTeam={ownerIsTeam}
              description={description}
              hideByline={hideByline}
              isPrivate={isPrivate}
              action={
                (action || follow) && (
                  <div className="flex flex-wrap items-center gap-2">
                    {action}
                    {follow}
                  </div>
                )
              }
            />

            {/* Mobile only — social proof up top instead of buried in the rail. */}
            {usedByBlock && <div className="mt-8 lg:hidden">{usedByBlock}</div>}

            {/* Capabilities first — what installing the kit's skills can do. */}
            {capabilities && (
              <section id="permissions" className="mt-8 scroll-mt-24">
                <TrustPanel
                  capabilities={capabilities.capabilities}
                  analysis={capabilities.analysis}
                  findings={capabilities.findings}
                  blindSpots={capabilities.blindSpots}
                  unscannedSkills={capabilities.unscannedSkills}
                  unavailableSkills={capabilities.unavailableSkills}
                  aggregate
                />
              </section>
            )}

            <section className="mt-8">
              <KitSkillList entries={skills} owner={owner} />
            </section>

            {mainExtra && <div className="mt-8 flex flex-col gap-8">{mainExtra}</div>}
          </div>
        </div>
      </main>
    </div>
  )
}
