'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { browseFeaturedHref, browseAllHref } from '@/lib/urls'
import { CategoryMark, SectionMark } from '@/components/category-mark'
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
  SECTION_LABEL,
  SECTION_SLUG,
  isCategoryKey,
  isSectionSlug,
} from '@/lib/categories'

/**
 * MOBILE Browse nav: Featured · All Skills · Code ▾ · Creative ▾ · Grow ▾.
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

  const tabCls = (on: boolean) =>
    `shrink-0 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors ${
      on
        ? 'border-(--ink) font-semibold text-(--ink)'
        : 'border-transparent text-(--ink-2) hover:text-(--ink)'
    }`

  return (
    <div className="border-b border-(--line) bg-(--surface)">
      <div className="mx-auto flex max-w-[1320px] items-center gap-1 overflow-x-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
          All Skills
        </Link>
        {CATEGORIES_BY_SECTION.map(({ section, categories }) => {
          const on = activeSection === section || activeSectionSlug === SECTION_SLUG[section]
          return (
            <DropdownMenu key={section}>
              <DropdownMenuTrigger
                aria-label={`${SECTION_LABEL[section]} categories`}
                className={`${tabCls(on)} group inline-flex items-center gap-1.5 outline-none`}
              >
                <SectionMark section={section} />
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
                    className={`flex items-center gap-2.5 text-xs font-semibold uppercase tracking-wider ${
                      activeSectionSlug === SECTION_SLUG[section] ? 'text-(--accent)' : ''
                    }`}
                  >
                    <SectionMark section={section} />
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
                      <CategoryMark cat={c} />
                      {c.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        })}
      </div>
    </div>
  )
}
