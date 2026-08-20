import type { Metadata } from 'next'
import { Suspense } from 'react'
import {
  ExploreSurface,
  parseDirectoryOffset,
  parseBrowseView,
  type BrowseView as BrowseViewKind,
} from '../skills/explore-surface'
import { ogMeta, OG } from '@/lib/og'
import {
  CATEGORY_BY_KEY,
  isCategoryKey,
  SECTION_BLURB,
  SECTION_LABEL,
  sectionFromSlug,
} from '@/lib/categories'
import { BrowseGridSkeleton } from '@/components/browse/browse-grid-skeleton'

export type BrowseSearchParams = {
  type?: string | string[]
  q?: string | string[]
  offset?: string | string[]
  sort?: string | string[]
}

/** Search/sort/pagination are query state; type and category are the path. */
export function parseBrowseQuery(sp: BrowseSearchParams) {
  const view = parseBrowseView(sp.type)
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim() ?? ''
  const offset = parseDirectoryOffset(sp.offset)
  const sortRaw = Array.isArray(sp.sort) ? sp.sort[0] : sp.sort
  // 'followers' only applies to People; other endpoints treat unknown sorts as
  // their install-ranked default. Default (no param) is 'new' everywhere — the
  // full catalog is the "what's fresh" view, since Featured already owns the
  // popularity charts. Keep this in sync with SortControl's defaultValue.
  const valid =
    sortRaw === 'new' || sortRaw === 'alpha' || sortRaw === 'followers' || sortRaw === 'popular'
  const sort = valid ? sortRaw : 'new'
  return { view, q, offset, sort }
}

/** Per-category (and per-section) title + description so each browse landing is
 *  its own SEO page. Accepts a category key or a section slug. */
export function browseMetadata(segment: string): Metadata {
  const cat = isCategoryKey(segment) ? CATEGORY_BY_KEY[segment] : null
  if (cat) {
    return {
      // "skills for AI agents" over "skills & kits" — "kit" is a Skillet-internal
      // noun no one searches; this leads with the keyword people actually google.
      title: `${cat.label} skills for AI agents · Skillet`,
      description: `${cat.label} skills and kits for AI agents like Claude, Codex, and Cursor. ${cat.blurb} Install from the page or with skillet add @author/skill.`,
      ...ogMeta(OG.skills()),
    }
  }
  const section = sectionFromSlug(segment)
  if (section) {
    const label = SECTION_LABEL[section]
    return {
      title: `${label} skills for AI agents · Skillet`,
      description: `${label} skills and kits for AI agents like Claude, Codex, and Cursor. ${SECTION_BLURB[section]} Install from the page or with skillet add @author/skill.`,
      ...ogMeta(OG.skills()),
    }
  }
  return {
    title: 'AI agent skills · Skillet',
    description:
      'The full directory of AI agent skills and kits for Claude, Codex, and Cursor, and the people who publish them. Newest first, searchable, and installable from the page or via skillet add.',
    ...ogMeta(OG.skills()),
  }
}

/**
 * The Browse grid — the only part that changes between category/type views. The
 * surrounding chrome (sidebar, header, tabs, sort) lives in the persistent
 * {@link BrowseChrome} layout, so switching views only re-streams this.
 */
export function BrowseGrid({
  view,
  category,
  q,
  offset,
  sort,
}: {
  view: BrowseViewKind
  category: string
  q: string
  offset: number
  sort: string
}) {
  return (
    <Suspense fallback={<BrowseGridSkeleton />}>
      <ExploreSurface q={q} offset={offset} tab={view} category={category} sort={sort} />
    </Suspense>
  )
}
