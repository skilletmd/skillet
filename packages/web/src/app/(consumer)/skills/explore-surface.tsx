import Link from 'next/link'
import { auth } from '@/auth'
import {
  getKitCatalog,
  getPeopleCatalog,
  getSkillCatalog,
  type KitCatalogEntry,
  type PersonCatalogEntry,
} from '@/lib/registry'
import type { SkillCatalogResponse, SkillSummary } from '@/lib/types'
import { softRegistry } from '@/lib/registry-soft'
import { DirectoryPagination } from './directory-pagination'
import { SkillSummaryCard } from './skill-summary-card'
import { KitCard } from '@/components/kit-card'
import { SkillCard } from '@/components/skill-card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { KitCardMenu } from '@/components/kits/kit-card-menu'
import { kitCardMenu } from '@/lib/kit-card-menu'
import { PersonDirectoryCard } from './person-directory-card'
import { withViewerFollows } from '@/lib/follows-server'
import { Avatar } from '@/components/ui/avatar'
import { ArrowRight } from '@/components/ui/icons'
import { usedByFacesFromWire } from '@/lib/used-by'
import { SubscribeKitButton } from '@/components/kits/subscribe-kit-button'
import { kitHref } from '@/lib/urls'
import { browseSsrLog, browseSsrSpan, withBrowseSsrProbe, BROWSE_SSR_RID_HEADER, isBrowseSsrProbeEnabled } from '@/lib/browse-ssr-probe'
import { headers } from 'next/headers'

const PAGE_SIZE = 24
const STRIP_SIZE = 6

const GRID_CLASS = 'grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3'
// The two-up directory grid shared by the skills and people catalogs so the
// card width (and everything that depends on it) is identical across tabs.
const DIRECTORY_GRID = 'grid grid-cols-1 gap-x-6 gap-y-6 md:grid-cols-2'

// The catalog type the home tab bar is showing.
export type DirectoryTab = 'skills' | 'kits' | 'people'

// Browse's primary axis. 'all' is the default user-facing view: skills and kits
// together (a user wants "something to write better", not a type). 'skills' /
// 'kits' remain for deep links and "see all". 'people' is its own journey.
export type BrowseView = DirectoryTab | 'all'

export function parseBrowseView(value: string | string[] | undefined): BrowseView {
  const raw = Array.isArray(value) ? value[0] : value
  return raw === 'skills' || raw === 'kits' || raw === 'people' ? raw : 'all'
}

// Browse URL for a catalog tab. Type is a path segment now; the search box and
// pager merge `q` / `offset` on as query state.
export function catalogHref(tab: DirectoryTab): string {
  return `/browse/${tab}`
}

export function parseDirectoryTab(value: string | string[] | undefined): DirectoryTab {
  const raw = Array.isArray(value) ? value[0] : value
  return raw === 'kits' || raw === 'people' ? raw : 'skills'
}

export function parseDirectoryOffset(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

/**
 * The /browse directory: the searchable, paginated catalog of skills, kits, and
 * people. The curated landing lives on the homepage; this is the exhaustive
 * "show me everything and let me filter" surface.
 */
export async function ExploreSurface({
  q,
  offset,
  tab,
  category = '',
  sort = '',
}: {
  q: string
  offset: number
  tab: BrowseView
  /** Active category filter (content views); '' = all. */
  category?: string
  /** Sort token, resolved by parseBrowseQuery: '' (install-ranked) | 'new'
   *  (default for skills & kits) | 'alpha' | 'followers' (people). */
  sort?: string
}) {
  // Only touch headers() when the probe is on — unit tests call ExploreSurface
  // outside a Next request store, and probe-off is the hot path anyway.
  let rid: string | undefined
  if (isBrowseSsrProbeEnabled()) {
    const h = await headers()
    rid = h.get(BROWSE_SSR_RID_HEADER) ?? undefined
  }

  return withBrowseSsrProbe(async () => {
    browseSsrLog('page_start', {
      tab,
      offset,
      has_q: Boolean(q.trim()),
      category: category || '(none)',
      sort: sort || '(default)',
    })

    const session = await browseSsrSpan('page_auth', () => auth())
    browseSsrLog('auth', {
      authed: Boolean(session?.user),
    })
    const ownHandle = session?.handle ?? null

    try {
      if (tab === 'people') {
        return await browseSsrSpan('page_people_tab', () =>
          PeopleTab({ q, offset, category, sort }),
        )
      }

      // Await strip + grid (in parallel when both run) so a soft catalog outage
      // settles into empty UI inside this Suspense boundary, instead of letting an
      // async child throw past it.
      const include = tab === 'skills' ? 'skills' : tab === 'kits' ? 'kits' : 'all'
      const wantStrip = tab === 'all' && !q && offset === 0
      const [strip, grid] = await browseSsrSpan('page_strip_grid', () =>
        Promise.all([
          wantStrip
            ? browseSsrSpan('page_people_strip', () => PeopleStrip({ category }))
            : Promise.resolve(null),
          browseSsrSpan('page_content_grid', () =>
            ContentGrid({
              q,
              offset,
              category,
              sort,
              viewerHandle: ownHandle,
              include,
            }),
          ),
        ]),
      )

      return (
        <div>
          {strip}
          {grid}
        </div>
      )
    } finally {
      browseSsrLog('page_done', { tab })
    }
  }, rid)
}

/**
 * The default Browse view: skills and kits together, organized by what they are
 * — kits on top (starter packs), then skills (the granular pieces). One search +
 * category filter spans both. Skills paginate; kits show the top matches with a
 * "see all" into the kits-only view.
 */
const KIT_BAND_SIZE = 8
// Kits are album-style square tiles — capped so they stay compact and never
// balloon to half the page when only a couple exist. Inline style because
// Tailwind's JIT can't reliably emit a comma-laden arbitrary grid-template.
const KITS_GRID_STYLE = { gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 220px))' } as const
const SKILLS_GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3'

function MergedSectionHeader({
  title,
  blurb,
  seeAllHref,
}: {
  title: string
  blurb: string
  seeAllHref?: string
}) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-(--ink)">{title}</h2>
        <p className="mt-1 text-sm text-(--ink-2)">{blurb}</p>
      </div>
      {seeAllHref && (
        <Link
          href={seeAllHref}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-(--accent) hover:underline"
        >
          See all <ArrowRight />
        </Link>
      )}
    </div>
  )
}

/** Skills lead; the top kits are sprinkled evenly among them (no separate
 *  section) so the grid reads as one surface of "help", not two product types. */
type Row = { type: 'skill'; skill: SkillSummary } | { type: 'kit'; kit: KitCatalogEntry }
function interleave(skills: SkillSummary[], kits: KitCatalogEntry[]): Row[] {
  const out: Row[] = []
  if (kits.length === 0) return skills.map((skill) => ({ type: 'skill', skill }))
  const gap = Math.max(3, Math.ceil(skills.length / (kits.length + 1)))
  let ki = 0
  skills.forEach((skill, i) => {
    out.push({ type: 'skill', skill })
    if ((i + 1) % gap === 0 && ki < kits.length) out.push({ type: 'kit', kit: kits[ki++] })
  })
  while (ki < kits.length) out.push({ type: 'kit', kit: kits[ki++] })
  return out
}

async function ContentGrid({
  q,
  offset,
  category,
  sort,
  viewerHandle,
  include,
}: {
  q: string
  offset: number
  category: string
  sort: string
  viewerHandle: string | null
  /** 'all' interleaves kits among skills; 'skills'/'kits' show one type only. */
  include: 'all' | 'skills' | 'kits'
}) {
  const wantSkills = include !== 'kits'
  const wantKits = include !== 'skills'
  const emptySkills: SkillCatalogResponse = { skills: [], total: 0, limit: PAGE_SIZE, offset }
  const emptyKits = {
    items: [] as KitCatalogEntry[],
    total: 0,
    limit: include === 'kits' ? PAGE_SIZE : KIT_BAND_SIZE,
    offset: include === 'kits' ? offset : 0,
  }
  // Soft each leg so Promise.all can't fail-closed on one registry outage.
  // We skip the always-on people catalog fan-out for maker avatars — cards fall
  // back to identicons; PeopleStrip owns the people peek on the All view.
  browseSsrLog('grid_enter', { include, offset, has_q: Boolean(q.trim()) })
  const [kitRes, skillRes] = await Promise.all([
    wantKits
      ? browseSsrSpan('grid_kits', () =>
          softRegistry(
            'browse catalog soft-fail (kits)',
            getKitCatalog({
              limit: include === 'kits' ? PAGE_SIZE : KIT_BAND_SIZE,
              offset: include === 'kits' ? offset : 0,
              q,
              category,
              sort,
            }),
            emptyKits,
          ),
        )
      : Promise.resolve(null),
    wantSkills
      ? browseSsrSpan('grid_skills', () =>
          softRegistry(
            'browse catalog soft-fail (skills)',
            getSkillCatalog({ limit: PAGE_SIZE, offset, q, category, sort }),
            emptySkills,
          ),
        )
      : Promise.resolve(null),
  ])

  const skills = skillRes?.skills ?? []
  // In 'all', kits ride along on the first page only (deeper pages are the skill
  // pager). In 'kits', kits ARE the page and paginate themselves.
  const kits =
    include === 'kits' ? (kitRes?.items ?? []) : offset === 0 ? (kitRes?.items ?? []) : []
  // Pagination follows whichever type owns the page.
  const total = include === 'kits' ? (kitRes?.total ?? 0) : (skillRes?.total ?? 0)
  const limit = include === 'kits' ? (kitRes?.limit ?? PAGE_SIZE) : (skillRes?.limit ?? PAGE_SIZE)

  const rows = interleave(skills, kits)

  if (rows.length === 0) {
    return (
      <EmptyState variant="card">
        {q
          ? `Nothing matches “${q}”.`
          : 'Nothing here yet. Try another category, or publish the first one.'}
      </EmptyState>
    )
  }

  return (
    <>
      <div className={DIRECTORY_GRID}>
        {rows.map((row) =>
          row.type === 'skill' ? (
            <SkillCard
              key={row.skill.skill_id}
              size="md"
              author={row.skill.author}
              slug={row.skill.slug}
              title={row.skill.title}
              description={row.skill.description}
              category={row.skill.category}
              installCount={row.skill.install_count}
              makerAvatarUrl={null}
              usedByFaces={usedByFacesFromWire(row.skill.used_by)}
            />
          ) : (
            <KitCard
              key={row.kit.id}
              size="md"
              kitId={row.kit.id}
              href={kitHref(row.kit.owner, row.kit.slug)}
              name={row.kit.name}
              owner={row.kit.owner}
              description={row.kit.description}
              category={row.kit.category}
              skillCount={row.kit.skillCount}
              subscriberCount={row.kit.subscriberCount}
              skillRefs={row.kit.skillRefs ?? []}
              skillCategories={row.kit.skillCategories ?? []}
              makerAvatarUrl={null}
              usedByFaces={row.kit.usedBy ?? []}
              action={
                viewerHandle === row.kit.owner ? (
                  <Button href={`/settings/kits/${row.kit.id}`} variant="secondary" size="sm">
                    Manage
                  </Button>
                ) : (
                  <SubscribeKitButton
                    kitId={row.kit.id}
                    owner={row.kit.owner}
                    viewerHandle={viewerHandle}
                    initialSubscribed={false}
                  />
                )
              }
            />
          ),
        )}
      </div>
      <DirectoryPagination total={total} limit={limit} offset={offset} />
    </>
  )
}

async function PeopleTab({
  q,
  offset,
  category = '',
  sort = '',
}: {
  q: string
  offset: number
  category?: string
  sort?: string
}) {
  const emptyPeople = {
    items: [] as PersonCatalogEntry[],
    total: 0,
    limit: PAGE_SIZE,
    offset,
  }
  // Browse people grid stays public on SSR — Following paints from client
  // follow context after membership bootstrap is deferred on /browse*.
  browseSsrLog('people_tab_enter', { offset, has_q: Boolean(q.trim()) })
  const [{ items, total, limit }, session] = await Promise.all([
    browseSsrSpan('people_tab_catalog', () =>
      softRegistry(
        'browse catalog soft-fail (people)',
        getPeopleCatalog({ limit: PAGE_SIZE, offset, q, category, sort }),
        emptyPeople,
      ),
    ),
    browseSsrSpan('people_tab_auth', () => auth()),
  ])
  const isAuthed = !!session?.user
  const people = withViewerFollows(items, new Set())

  return (
    <>
      {people.length === 0 ? (
        <EmptyState variant="card">
          {q ? `No people match “${q}”.` : 'No one to discover yet.'}
        </EmptyState>
      ) : (
        <div className={DIRECTORY_GRID}>
          {people.map((person) => (
            <PersonDirectoryCard key={person.handle} person={person} isAuthed={isAuthed} />
          ))}
        </div>
      )}
      <DirectoryPagination total={total} limit={limit} offset={offset} />
    </>
  )
}

/** The avatar tray on the All view: a horizontal peek at people worth following,
 *  scoped to the active category. A face is the right primitive for a person —
 *  so people ride above the content grid as circles, not as cards mixed in. */

// The tray fills whatever width it gets: every slot is a fixed 96px (+8px gap),
// and each face past the second appears only once the container fits it whole —
// so the row always ends on a full face with "View all" in the last slot. No
// scroll, no half-clipped avatar, and display:none keeps hidden ones out of the
// tab order. Thresholds are 96 (View all) + 104 × faces.
const TRAY_SLOTS = [
  '',
  '',
  'hidden @min-[408px]:block',
  'hidden @min-[512px]:block',
  'hidden @min-[616px]:block',
  'hidden @min-[720px]:block',
  'hidden @min-[824px]:block',
  'hidden @min-[928px]:block',
  'hidden @min-[1032px]:block',
  'hidden @min-[1136px]:block',
  'hidden @min-[1240px]:block',
  'hidden @min-[1344px]:block',
  'hidden @min-[1448px]:block',
  'hidden @min-[1552px]:block',
]

async function PeopleStrip({ category }: { category: string }) {
  const { items } = await browseSsrSpan('people_strip', () =>
    softRegistry(
      'browse catalog soft-fail (people strip)',
      getPeopleCatalog({ limit: TRAY_SLOTS.length, category }),
      { items: [] as PersonCatalogEntry[], total: 0, limit: TRAY_SLOTS.length, offset: 0 },
    ),
  )
  if (items.length === 0) return null
  const seeAllHref = category ? `/browse/${category}/people` : '/browse/people'

  return (
    // No heading — the handles already say "people". The tray just exists, and
    // the last slot is the "View all" door into the full people directory.
    <section aria-label="People to follow" className="mb-6 @container">
      {/* overflow-x only ever engages below ~330px, where even the two
          always-on faces can't fit — everywhere else the slots fit by math. */}
      <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((person, i) => (
          <li key={person.handle} className={`shrink-0 ${TRAY_SLOTS[i]}`}>
            <Link
              href={`/${person.handle}`}
              className="group flex w-24 flex-col items-center gap-2 rounded-xl px-2.5 py-2 text-center transition-colors hover:bg-(--surface)"
            >
              <Avatar
                src={person.avatarUrl}
                name={person.name}
                colorKey={person.handle}
                size="md"
                className="h-12 w-12 text-base transition-transform duration-200 group-hover:scale-105"
                aria-hidden="true"
              />
              <span className="block max-w-full truncate whitespace-nowrap text-xs font-medium text-(--ink-2) group-hover:text-(--ink)">
                @{person.handle}
              </span>
            </Link>
          </li>
        ))}
        <li className="shrink-0">
          <Link
            href={seeAllHref}
            className="group flex w-24 flex-col items-center gap-2 rounded-xl px-2.5 py-2 text-center transition-colors hover:bg-(--surface)"
          >
            <span
              aria-hidden="true"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-(--line) bg-(--surface) text-(--ink-2) transition-colors group-hover:border-(--accent) group-hover:text-(--accent)"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path
                  d="M3 9h11M10 5l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="block whitespace-nowrap font-mono text-xs text-(--ink-2) group-hover:text-(--ink)">
              View all
            </span>
          </Link>
        </li>
      </ul>
    </section>
  )
}
