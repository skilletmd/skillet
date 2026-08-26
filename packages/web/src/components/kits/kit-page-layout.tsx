import { type ReactNode } from 'react'
import Link from 'next/link'
import { DetailHeader, DETAIL_MEDIA_SLOT } from '@/components/detail-header'
import { KitSkillList } from '@/components/kits/kit-skill-list'
import { TrustPanel } from '@/components/skills/trust-panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { AuthorAboutRow } from '@/components/author-about-row'
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
  // Body
  heroSeed,
  skills,
  capabilities,
  usedByBlock,
  /** Extra sections in the main column, below the skill list (a named kit's
   *  install command + version history; empty for the virtual author-kit). */
  mainExtra,
  /** The author, one line (AuthorAboutRow `inline`): avatar, name, handle,
   *  Follow. Goes in the hero byline, above the kit's name — see DetailHeader's
   *  `byline`. The About rail carries the kit's own facts and nothing else. */
  authorRow,
  /** Extra rail sections (more-from-owner + people-also-added on a named kit;
   *  empty on the author-kit). */
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
  heroSeed: string
  skills: KitSkillEntry[]
  capabilities: KitCapabilities
  usedByBlock?: ReactNode
  mainExtra?: ReactNode
  authorRow?: ReactNode
  railExtra?: ReactNode
}) {
  // One cover node, rendered in two slots: a small square beside the identity on
  // a phone, the full-size rail tile from lg. Only one is ever visible.
  const cover = coverNode ?? (
    <PaintedCover
      seed={kitId}
      categories={kitCoverCategories(categories, null, categories.length, kitId)}
    />
  )
  // The rail's About facts — who made it, how big, how fresh. Defined once and
  // placed by breakpoint: rail on desktop, directly under the hero on a phone.
  const aboutBlock = (
    <section className="py-4 first:pt-0">
      <Eyebrow>About</Eyebrow>
      {/* The kit's own facts. The author is no longer here: they lead the hero
          now, with a face and a real name, instead of being a rail entry the
          reader had to go find. */}
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
  )
  // Phone version of the same facts, folded onto ONE line: who made it, then
  // the kit's own facts, dot-separated. The "About" eyebrow labelled nothing a
  // reader could not already see, the author's handle sat on a line of its own,
  // and the count and the freshness took a row each — five rows for three
  // facts, directly above the permissions the reader actually came to weigh.
  // Each fact keeps its icon — they are the column that tells the eye which
  // kind of fact it is reading, and a run of bare dot-separated phrases loses
  // that. Wraps rather than truncates on the narrowest phones.
  const aboutBlockCompact = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-(--ink-2)">
      <span className="flex items-center gap-1.5">
        <SkillsGlyph />
        {skillCount} {skillCount === 1 ? 'skill' : 'skills'}
      </span>
      {updatedAt != null && (
        <span className="flex items-center gap-1.5">
          <UpdatedGlyph />
          Updated {timeAgo(updatedAt, { suffix: true })}
        </span>
      )}
    </div>
  )
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
          {/* LEFT rail — cover, then About, then discovery + runtime reach.
              DESKTOP ONLY, as a whole. On a phone this column stacks ABOVE the
              main one, so anything left in it lands between the header and the
              kit's own name: the cover, the author, and two screens of other
              people's kits all arrived before the reader learned what this kit
              was. Every piece therefore has a placed mobile copy in the main
              column below, and hiding the <aside> itself (rather than each
              child) is what keeps the grid from reserving an empty row + gap. */}
          <aside className="hidden lg:order-first lg:sticky lg:top-24 lg:block">
            {/* 90% of the rail, not the full width: at full width the cover was
                the heaviest thing on the page and squared off flush with the
                content column, which read as a second column rather than a
                mark. Left-aligned, so it still hangs on the same edge as the
                About rows beneath it. */}
            <div className="mb-6 relative aspect-square w-[90%] overflow-hidden rounded-2xl shadow-sm ring-1 ring-black/5">
              {cover}
            </div>

            {aboutBlock}

            {/* Wrapping makes UsedBy's `py-4 first:pt-0` section the first child
                of a NEW parent, so `pt-0` fires and this block loses the top
                padding every other rail section has. Restore it here rather than
                in UsedBy, which renders correctly wherever it is not wrapped. */}
            {usedByBlock && <div className="[&>section:first-child]:pt-4">{usedByBlock}</div>}

            {railExtra}

            <WorksWithRail />

            {/* No "Make your own" here. Authoring is a supply action on a
                demand page: this visitor came for someone else's kit, and the
                prompt competed with the one decision the page is asking for.
                Creating has a home in the header + and on your own profile. */}
          </aside>

          {/* MAIN — KIT BY @owner identity + actions, then the kit body. */}
          <div className="min-w-0 lg:mt-2 [&>*:first-child]:mt-0">
            <DetailHeader
              kind="kit"
              byline={authorRow}
              media={
                <div
                  className={`${DETAIL_MEDIA_SLOT} relative size-16 shrink-0 overflow-hidden rounded-xl shadow-sm ring-1 ring-black/5 lg:hidden`}
                >
                  {cover}
                </div>
              }
              title={name}
              owner={owner}
              description={description}
              hideByline={hideByline}
              isPrivate={isPrivate}
              action={action}
            />

            {/* Mobile only, and in decision order: who made it and how fresh it
                is (About), then who else added it (social proof) — both right
                under the name and the Add button they qualify, not stranded
                above the kit or below the skill list. */}
            <div className="mt-4 lg:hidden">{aboutBlockCompact}</div>
            {usedByBlock && <div className="mt-2 lg:hidden">{usedByBlock}</div>}

            <section className="mt-6">
              <KitSkillList entries={skills} owner={owner} />
            </section>

            {/* Permissions AFTER the list. What the kit contains is the question
                a reader arrives with; what it is allowed to do is the one they
                ask once the contents have earned a second look. Above the list
                it made a wall of warning chips the first thing on the page. The
                `#permissions` anchor still lands here. */}
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

            {mainExtra && <div className="mt-8 flex flex-col gap-8">{mainExtra}</div>}

            {/* Mobile only — the rail's discovery tail, after the kit itself. */}
            <div className="mt-10 border-t border-(--line) lg:hidden [&>section:first-child]:pt-4">
              {railExtra}
              <WorksWithRail />
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
