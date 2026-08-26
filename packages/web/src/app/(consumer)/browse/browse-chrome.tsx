'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Fragment, Suspense, useEffect, useState, useTransition, type ReactNode } from 'react'
import { SortControl, PEOPLE_SORTS } from '../skills/sort-control'
import { browseFeaturedHref, browseAllHref } from '@/lib/urls'
import { CategoryMark, SectionMark } from '@/components/category-mark'
import { CategoryIcon } from '@/components/category-icons'
import { TabBar, Tab } from '@/components/ui/tabs'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  CATEGORIES_BY_SECTION,
  CATEGORY_BY_KEY,
  SECTION_BLURB,
  SECTION_GLYPH_COLOR,
  SECTION_LABEL,
  SECTION_SLUG,
  isCategoryKey,
  isSectionSlug,
  sectionFromSlug,
  type Category,
} from '@/lib/categories'

// 'featured' is the curated view at /browse/featured; the rest are the All Skills
// grid (the canonical /browse). 'featured' is intentionally NOT a category key — a
// static /browse/featured route wins over the /browse/[category] dynamic segment,
// and a drift test asserts it never becomes a CategoryKey.
export type BrowseViewKind = 'all' | 'skills' | 'kits' | 'people'
const TYPES: BrowseViewKind[] = ['skills', 'kits', 'people']

/** Derive the active {category, view} from the URL — /browse, /browse/<seg1>,
 *  /browse/<category>/<type>. The chrome lives in the persistent layout, so it
 *  reads the path itself instead of taking props that would force a re-mount. */
/** The four result-type filters and where each one points, for a given category.
 *  Exported so the phone chrome bar (BrowseStrip) and the desktop tabs offer the
 *  same four choices at the same hrefs — two lists would drift. */
export function browseTypes(
  category: string,
): { key: BrowseViewKind; label: string; href: string }[] {
  const href = (t: BrowseViewKind) =>
    t === 'all'
      ? category
        ? `/browse/${category}`
        : '/browse/all'
      : category
        ? `/browse/${category}/${t}`
        : `/browse/${t}`
  return [
    { key: 'all', label: 'All', href: href('all') },
    { key: 'skills', label: 'Skills', href: href('skills') },
    { key: 'kits', label: 'Kits', href: href('kits') },
    { key: 'people', label: 'People', href: href('people') },
  ]
}

export function parseBrowsePath(pathname: string): {
  category: string
  view: BrowseViewKind
  featured: boolean
} {
  const parts = pathname.split('/').filter(Boolean) // ['browse', seg1?, seg2?]
  const seg1 = parts[1]
  const seg2 = parts[2]
  // /browse is the Featured view; /browse/all is the full grid.
  if (!seg1 || seg1 === 'featured') return { category: '', view: 'all', featured: true }
  if (seg1 === 'all') return { category: '', view: 'all', featured: false }
  if ((TYPES as string[]).includes(seg1))
    return { category: '', view: seg1 as BrowseViewKind, featured: false }
  const view = seg2 && (TYPES as string[]).includes(seg2) ? (seg2 as BrowseViewKind) : 'all'
  // A section slug (creative/code/grow) is a valid filter segment too — keep it as
  // the active `category` so the rail highlights its header and the type tabs nest
  // under it.
  const isFilter = isCategoryKey(seg1) || isSectionSlug(seg1)
  return { category: isFilter ? seg1 : '', view, featured: false }
}

/** Featured | All Skills — two full-width stacked nav items at the top of the left
 *  rail, styled like the category links. All Skills is the canonical /browse grid;
 *  Featured is the curated view. Both keep the category sidebar below. */
function BrowseViewTabs({
  featured,
  category,
  className = '',
}: {
  featured: boolean
  category: string
  className?: string
}) {
  const item = (href: string, active: boolean, label: string) => (
    <Link
      href={href}
      prefetch={false}
      scroll={false}
      onClick={scrollToTop}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center rounded-md px-3 py-1.5 text-sm transition-colors ${
        active
          ? 'bg-(--accent-bg) font-medium text-(--accent)'
          : 'text-(--ink-2) hover:bg-(--surface) hover:text-(--ink)'
      }`}
    >
      {label}
    </Link>
  )
  return (
    <nav
      aria-label="Browse view"
      className={`mb-3 flex flex-col gap-0.5 border-b border-(--line) pb-3 ${className}`}
    >
      {item(browseFeaturedHref(), featured, 'Featured')}
      {/* On a category page the active filter is the category (in the list
          below), so All Skills isn't the selected view. */}
      {item(browseAllHref(), !featured && category === '', 'All Skills')}
    </nav>
  )
}

// Everything is path-based: picking a category keeps the active type as the nested
// segment (/browse/frontend/people). Clearing back to all categories is the view
// tabs' job (Featured / All Skills), so there's no standalone "All" link here.
function categoryLinks(view: BrowseViewKind) {
  const typeSeg = view !== 'all' ? `/${view}` : ''
  return {
    catHref: (key: string) => `/browse/${key}${typeSeg}`,
  }
}

// Picking a filter re-streams only the grid inside the persistent chrome. Next's
// own scroll restoration then scrolls the changed segment (the grid, below the
// hero) into view — landing you at the grid, not the top, and racing any scroll
// we do on click. So filter links carry scroll={false} to silence Next's scroll,
// and we own it here: back to the top so a new filter starts at its heading, the
// way a fresh page load would.
function scrollToTop() {
  window.scrollTo({ top: 0 })
}

// Which category sections the user has collapsed, persisted so it survives
// remounts (navigating away and back) and reloads. Hydrated after mount to keep
// the server/client first render identical.
const COLLAPSED_KEY = 'browse:collapsed-sections'

function useCollapsedSections() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLLAPSED_KEY)
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]))
    } catch {
      // ignore malformed/unavailable storage — sections just start expanded
    }
  }, [])
  const toggle = (section: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]))
      } catch {
        // best-effort persistence
      }
      return next
    })
  return { collapsed, toggle }
}

function CategorySidebar({ view, category }: { view: BrowseViewKind; category: string }) {
  const { catHref } = categoryLinks(view)
  const { collapsed, toggle } = useCollapsedSections()
  const link = (href: string, active: boolean, label: string, swatch?: Category) => (
    <Link
      key={label}
      href={href}
      prefetch={false}
      scroll={false}
      onClick={scrollToTop}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-2.5 rounded-md py-1.5 pr-3 text-sm transition-colors ${
        swatch ? 'pl-6' : 'pl-3'
      } ${
        active
          ? 'bg-(--accent-bg) font-medium text-(--accent)'
          : 'text-(--ink-2) hover:bg-(--surface) hover:text-(--ink)'
      }`}
    >
      {swatch && (
        <span
          className="grid size-4 shrink-0 place-items-center text-base"
          style={{ color: SECTION_GLYPH_COLOR[swatch.section] }}
        >
          <CategoryIcon cat={swatch.key} />
        </span>
      )}
      {label}
    </Link>
  )
  return (
    <nav aria-label="Categories" className="flex flex-col gap-0.5">
      {CATEGORIES_BY_SECTION.map(({ section, categories }) => {
        const isCollapsed = collapsed.has(section)
        const sectionActive = category === SECTION_SLUG[section]
        return (
          <div key={section} className="mt-4 flex flex-col gap-0.5 first:mt-0">
            {/* The label links to the section landing (all of Design/Media/Writing
                at once); the chevron is a separate control that collapses the group. */}
            <div className="group flex items-center gap-1 pr-2">
              {/* Header in its section color, anchoring the 3-color system the
                  category glyphs use; active still flips to the accent. The old
                  hover shape is gone — the glyphs below now carry the section. */}
              <Link
                href={catHref(SECTION_SLUG[section])}
                prefetch={false}
                scroll={false}
                onClick={scrollToTop}
                aria-current={sectionActive ? 'page' : undefined}
                style={sectionActive ? undefined : { color: SECTION_GLYPH_COLOR[section] }}
                className={`flex flex-1 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wider transition-colors ${
                  sectionActive ? 'bg-(--accent-bg) text-(--accent)' : ''
                }`}
              >
                {/* The section's mark — the shape its kits print. */}
                <SectionMark section={section} size={9} />
                {SECTION_LABEL[section]}
              </Link>
              <button
                type="button"
                onClick={() => toggle(section)}
                aria-expanded={!isCollapsed}
                aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${SECTION_LABEL[section]}`}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-(--ink-2) transition-colors hover:bg-(--surface) hover:text-(--ink)"
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 12 12"
                  className={`h-3.5 w-3.5 opacity-0 transition-[transform,opacity] group-hover:opacity-100 ${
                    isCollapsed ? '-rotate-90 opacity-100' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 4.5 6 7.5 9 4.5" />
                </svg>
              </button>
            </div>
            {!isCollapsed &&
              categories.map((c) => link(catHref(c.key), category === c.key, c.label, c))}
          </div>
        )
      })}
    </nav>
  )
}

// Featured | All Skills as underline tabs — the mobile stand-in for the desktop
// rail's view tabs. Shares the Feed/Settings TabBar so every subnav reads the same;
// sits at the left of the mobile control row, riding the row's bottom border.
function ViewToggleMobile({ featured, category }: { featured: boolean; category: string }) {
  return (
    <TabBar aria-label="Browse view" className="!mb-0 !border-b-0 !pt-0">
      <Tab href={browseFeaturedHref()} active={featured}>
        Featured
      </Tab>
      {/* On a category page the active filter is the category (in the list below),
          so All Skills isn't the selected view. */}
      <Tab href={browseAllHref()} active={!featured && category === ''}>
        All Skills
      </Tab>
    </TabBar>
  )
}

// Shared trigger styling so Type / Category read identically to the Sort menu
// they sit beside.
const MENU_TRIGGER_CLASS =
  'group inline-flex h-11 items-center gap-1.5 rounded-md px-0.5 text-sm font-medium text-(--ink-2) outline-none transition-colors hover:text-(--ink) focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--accent) data-[state=open]:text-(--ink)'
const MENU_ITEM_ACTIVE = 'font-semibold text-(--accent) data-[highlighted]:text-(--accent)'

function MenuChevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4.5 6 7.5 9 4.5" />
    </svg>
  )
}

// Type filter as a quiet menu (mobile). On desktop this is the visible tab bar;
// on a narrow screen four tabs + a category strip + sort is too much, so type
// folds into a dropdown that sits next to Category and Sort.
function TypeMenu({
  types,
  view,
}: {
  types: { key: BrowseViewKind; label: string; href: string }[]
  view: BrowseViewKind
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const current = types.find((t) => t.key === view) ?? types[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Filter by type"
        className={`${MENU_TRIGGER_CLASS} ${isPending ? 'opacity-60' : ''}`}
      >
        Type:<span className="font-semibold text-(--ink)">{current.label}</span>
        <MenuChevron />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {types.map((t) => (
          <DropdownMenuItem
            key={t.key}
            onSelect={() => startTransition(() => router.push(t.href))}
            className={t.key === view ? MENU_ITEM_ACTIVE : ''}
          >
            {t.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Category filter as a menu (mobile). The full list is long, so it reveals on tap
// instead of eating a scrolling band. Clearing back to "All categories" keeps the
// active type segment.
function CategoryMenu({ view, category }: { view: BrowseViewKind; category: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const { catHref } = categoryLinks(view)
  const clearHref = view !== 'all' ? `/browse/${view}` : browseAllHref()
  const activeSection = sectionFromSlug(category)
  const activeLabel = isCategoryKey(category)
    ? CATEGORY_BY_KEY[category].label
    : activeSection
      ? SECTION_LABEL[activeSection]
      : 'All'
  const go = (href: string) =>
    startTransition(() => {
      router.push(href, { scroll: false })
      scrollToTop()
    })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Filter by category"
        className={`${MENU_TRIGGER_CLASS} ${isPending ? 'opacity-60' : ''}`}
      >
        Category:<span className="font-semibold text-(--ink)">{activeLabel}</span>
        <MenuChevron />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-[60vh] overflow-y-auto">
        <DropdownMenuItem
          onSelect={() => go(clearHref)}
          className={category === '' ? MENU_ITEM_ACTIVE : ''}
        >
          All categories
        </DropdownMenuItem>
        {CATEGORIES_BY_SECTION.map(({ section, categories }) => (
          <Fragment key={section}>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => go(catHref(SECTION_SLUG[section]))}
              className={`flex items-center gap-2.5 text-xs font-semibold uppercase tracking-wider ${
                category === SECTION_SLUG[section] ? MENU_ITEM_ACTIVE : ''
              }`}
            >
              <SectionMark section={section} />
              All {SECTION_LABEL[section]}
            </DropdownMenuItem>
            {categories.map((c) => (
              <DropdownMenuItem
                key={c.key}
                onSelect={() => go(catHref(c.key))}
                className={`flex items-center gap-2.5 ${category === c.key ? MENU_ITEM_ACTIVE : ''}`}
              >
                <CategoryMark cat={c} />
                {c.label}
              </DropdownMenuItem>
            ))}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Type filter as a segmented control (mobile). Categories + Featured/All now live
// in the top SectionNav strip, so the mobile toolbar is just Type ↔ Sort. Type is
// route-based, so the segmented control pushes the matching href.
function TypeSegmented({
  types,
  view,
}: {
  types: { key: BrowseViewKind; label: string; href: string }[]
  view: BrowseViewKind
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  return (
    <SegmentedControl
      ariaLabel="Filter by type"
      // Bare: no track, no pill. This control sits directly above the grid it
      // filters, where the chrome read as a second card competing with the
      // results.
      // -ml-2.5 pulls the first item's hit-padding outside the column so "All"
      // sits on the same left line as the strip above and the title below.
      className={`seg--bare -ml-2.5 ${isPending ? 'opacity-60' : ''}`}
      options={types.map((t) => ({ value: t.key, label: t.label }))}
      value={view}
      onChange={(key) => {
        const href = types.find((t) => t.key === key)?.href
        if (href) startTransition(() => router.push(href))
      }}
    />
  )
}

/**
 * Persistent Browse chrome — sidebar, header, type tabs, and sort. Lives in the
 * browse layout so it stays mounted as you switch category/type; only the grid
 * ({children}) re-streams. Active state is derived from the pathname, so a
 * client re-render (not a remount) updates the highlight instantly.
 */
export function BrowseChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { view, category, featured } = parseBrowsePath(pathname)
  const cat = isCategoryKey(category) ? CATEGORY_BY_KEY[category] : null
  const section = sectionFromSlug(category)

  // Title only. The standfirst under each heading restated what the grid below
  // already showed ("Curated kits you can install as one." over a wall of kits),
  // so it cost a line of vertical space on every browse surface and told the
  // reader nothing they could not see. The same sentences still ship as the
  // page's meta description in browse-view.tsx, where they do work.
  const header = featured
    ? { title: 'Featured' }
    : cat
      ? { title: cat.label }
      : section
        ? { title: SECTION_LABEL[section] }
        : view === 'people'
          ? { title: 'Browse people' }
          : view === 'skills'
            ? { title: 'Browse skills' }
            : view === 'kits'
              ? { title: 'Browse kits' }
              : { title: 'Browse skills & kits' }

  const types = browseTypes(category)

  // Below lg the mobile subnav row leads (no hero above it), so use the tight top
  // padding Feed/Settings use to put the tab bar at the same height. At lg the layout
  // switches to the rail + hero, which keeps the standard pt-10 breathing room.
  return (
    <main className="marketing-home consumer-theme mx-auto max-w-[1120px] px-[clamp(16px,4vw,32px)] pt-5 pb-12 sm:pt-6 sm:pb-16 lg:pt-10">
      <div className="flex gap-10">
        {/* Left rail: Featured | All Skills tabs, then the category sidebar — both
            shown on Featured and All Skills. self-start keeps the rail in flow but
            sized to its own content (not stretched to the row), so its bottom stays
            bounded by the row and it never bleeds past the content column into the
            footer. The content column's min-h reserves the rail's height so the
            pinned rail keeps its stick room while a category streams in. */}
        {/* px-1/-ml-1: breathing room inside the scroll container so the
            global focus outline (2px + 2px offset) isn't clipped at the
            overflow edge on the active item. */}
        <aside className="sticky top-28 hidden max-h-[calc(100vh-112px)] w-(--rail-nav) shrink-0 self-start overflow-y-auto py-1 pl-1 pr-4 -ml-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:block">
          <BrowseViewTabs featured={featured} category={category} />
          <CategorySidebar view={view} category={category} />
        </aside>

        <div className="min-h-[calc(100vh-112px)] min-w-0 flex-1">
          {/* The title sits under the chrome bar's rule, so it needs air ABOVE
              it to read as the page rather than the bar's caption — and less
              below, where the results start immediately. text-3xl was tuned for
              the desktop hero; on a phone it ran the full column width. */}
          <div className="mb-3 max-w-[60ch] sm:mb-5">
            {/* Category pages name their family: the section mark + label, in
                the section color, so a category's place in the three-shape
                system reads at the top of its page. */}
            {cat && (
              <div
                className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider"
                style={{ color: SECTION_GLYPH_COLOR[cat.section] }}
              >
                <SectionMark section={cat.section} size={9} />
                {SECTION_LABEL[cat.section]}
              </div>
            )}
            <h1 className="text-2xl font-semibold tracking-tight text-(--ink) sm:text-3xl">
              {header.title}
            </h1>
          </div>

          {/* Desktop: the type tab bar — categories live in the left rail, so only
              type + sort sit here. */}
          {!featured && (
            <div className="hidden flex-wrap items-center justify-between gap-3 border-b border-(--line) lg:flex">
              <TabBar aria-label="Browse type" className="!mb-0 !border-b-0 !pt-0">
                {types.map((t) => (
                  <Tab key={t.key} href={t.href} active={t.key === view}>
                    {t.label}
                  </Tab>
                ))}
              </TabBar>
              {/* SortControl reads useSearchParams, which must sit in a Suspense
                  boundary so the page can still prerender its static shell. */}
              <Suspense fallback={<div className="h-9 w-28" aria-hidden="true" />}>
                <SortControl
                  options={view === 'people' ? PEOPLE_SORTS : undefined}
                  defaultValue="new"
                />
              </Suspense>
            </div>
          )}

          <div className="mt-8">{children}</div>
        </div>
      </div>
    </main>
  )
}
