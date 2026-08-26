'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Suspense } from 'react'
import { ResultFilterMenu } from './result-filter-menu'
import { parseBrowsePath } from './browse-chrome'
import { browseFeaturedHref, browseAllHref } from '@/lib/urls'
import { SectionMark } from '@/components/category-mark'
import { CategoryIcon } from '@/components/category-icons'
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
  SECTION_GLYPH_COLOR,
  SECTION_LABEL,
  SECTION_SLUG,
  isCategoryKey,
  isSectionSlug,
} from '@/lib/categories'

/**
 * MOBILE Browse nav: Featured · All · Code ▾ · Creative ▾ · Grow ▾.
 *
 * Collapses the 15 flat category tabs into the 3 overarching sections, each a
 * dropdown of its categories — a short, scannable strip instead of a long
 * horizontal scroll. Featured/All Skills are direct; the active section is lit
 * when you're inside one of its categories. Type (skills/kits/people) and Sort
 * stay in the toolbar below — a separate axis.
 */
// Same rationale as the desktop rail: a new filter re-streams only the grid, so
// send the reader back to the top instead of leaving them mid-page.
function scrollToTop() {
  window.scrollTo({ top: 0 })
}

export function BrowseStrip() {
  const pathname = usePathname()
  const seg1 = pathname.split('/').filter(Boolean)[1]
  const activeCategory = seg1 && isCategoryKey(seg1) ? seg1 : ''
  const activeSectionSlug = seg1 && isSectionSlug(seg1) ? seg1 : ''
  const activeSection = activeCategory ? CATEGORY_BY_KEY[activeCategory].section : null
  const onFeatured = !seg1 || seg1 === 'featured'
  const onAll = seg1 === 'all'
  const { view } = parseBrowsePath(pathname)

  const tabCls = (on: boolean) =>
    `shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${
      on
        ? 'border-(--ink) font-semibold text-(--ink)'
        : 'border-transparent text-(--ink-2) hover:text-(--ink)'
    }`

  return (
    <div className="border-b border-(--line) bg-(--surface)">
      {/* ONE chrome bar. Type and Sort used to sit on a second row of their own,
          which cost 46px above the fold for two controls most visits never
          touch. They live here now, pinned right and OUTSIDE the scroll
          container — inside it they would scroll away with the categories. Both
          keep their current value visible ("All", "Newest") rather than
          collapsing to a bare glyph, so the bar still says what you are looking
          at. Featured is curated: no type, no sort. */}
      <div className="mx-auto flex max-w-[1320px] items-center gap-1 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Link
            href={browseFeaturedHref()}
            prefetch={false}
            aria-current={onFeatured ? 'page' : undefined}
            className={tabCls(onFeatured)}
          >
            Featured
          </Link>
          <Link
            href={browseAllHref()}
            prefetch={false}
            aria-current={onAll ? 'page' : undefined}
            className={tabCls(onAll)}
          >
            {/* "All", not "All Skills": the row is already crowded at 390px, and
              the grid it opens holds kits and people too. */}
            All
          </Link>
          {CATEGORIES_BY_SECTION.map(({ section, categories }) => {
            const on = activeSection === section || activeSectionSlug === SECTION_SLUG[section]
            return (
              <DropdownMenu key={section}>
                <DropdownMenuTrigger
                  aria-label={`${SECTION_LABEL[section]} categories`}
                  className={`${tabCls(on)} group inline-flex items-center gap-1.5 outline-none`}
                >
                  {/* No section mark here. Five items have to fit a 390px row,
                    and a shape whose meaning is only legible next to the other
                    two is not worth the width — the dropdown it opens carries
                    the section's color and mark where they can be read. */}
                  {SECTION_LABEL[section]}
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
                </DropdownMenuTrigger>
                <DropdownMenuContent className="max-h-[60vh] overflow-y-auto">
                  <DropdownMenuItem asChild>
                    <Link
                      href={`/browse/${SECTION_SLUG[section]}`}
                      prefetch={false}
                      scroll={false}
                      onClick={scrollToTop}
                      // Sentence case, not the uppercase section-label treatment:
                      // this row is a destination you tap ("All Grow"), the same
                      // kind of thing as the category rows under it — not a
                      // heading over them.
                      className={`flex items-center gap-2.5 font-medium ${
                        activeSectionSlug === SECTION_SLUG[section] ? 'text-(--accent)' : ''
                      }`}
                    >
                      <span style={{ color: SECTION_GLYPH_COLOR[section] }}>
                        <SectionMark section={section} />
                      </span>
                      All {SECTION_LABEL[section]}
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {categories.map((c) => (
                    <DropdownMenuItem key={c.key} asChild>
                      <Link
                        href={`/browse/${c.key}`}
                        prefetch={false}
                        scroll={false}
                        onClick={scrollToTop}
                        className={`flex items-center gap-2.5 ${
                          activeCategory === c.key ? 'font-semibold text-(--accent)' : ''
                        }`}
                      >
                        {/* Same mark as the desktop rail: the category's own glyph
                          in its SECTION color. The per-category swatch shape it
                          replaced gave every row a slightly different tint of
                          the same hue, which read as a gradient rather than a
                          grouping, and the glyph that names the category was
                          missing entirely. */}
                        <span
                          className="grid size-4 shrink-0 place-items-center text-base"
                          style={{ color: SECTION_GLYPH_COLOR[c.section] }}
                        >
                          <CategoryIcon cat={c.key} />
                        </span>
                        {c.label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )
          })}
        </div>

        {!onFeatured && (
          <Suspense fallback={<div className="h-9 w-9 shrink-0" aria-hidden="true" />}>
            <ResultFilterMenu category={activeCategory || activeSectionSlug} view={view} />
          </Suspense>
        )}
      </div>
    </div>
  )
}
