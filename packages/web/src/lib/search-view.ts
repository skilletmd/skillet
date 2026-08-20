// View-model helpers shared by the typeahead dropdown and the full results page.
// Keeps group ordering, labels, and the flattening that keyboard navigation
// relies on in one place so the two surfaces never drift.
import type { SearchGroupKey, SearchGroups, SearchResultItem } from '@/lib/registry'

/** The underlying data groups returned by search, in canonical order. Used for
 *  counting and for the "all" fetch. Display merges some of these — see below. */
export const SEARCH_GROUP_ORDER: SearchGroupKey[] = ['skills', 'kits', 'authors', 'teams', 'docs']

/**
 * Display sections — how results are grouped and filtered in the UI. Users and
 * Teams are merged into one "Users" section (people and the orgs they belong to
 * read as one thing), so the section/filter set is Skills · Kits · Users · Docs.
 * `id` is the `?type=` value and React key; `keys` are the data groups it spans.
 */
export interface SearchDisplaySection {
  id: string
  label: string
  keys: SearchGroupKey[]
}

export const SEARCH_DISPLAY_SECTIONS: SearchDisplaySection[] = [
  { id: 'skills', label: 'Skills', keys: ['skills'] },
  { id: 'kits', label: 'Kits', keys: ['kits'] },
  { id: 'users', label: 'Users', keys: ['authors', 'teams'] },
  { id: 'docs', label: 'Docs', keys: ['docs'] },
]

/** The data keys a display-section id maps to (for the typed fetch), or null. */
export function displaySectionKeys(id: string | null): SearchGroupKey[] | null {
  return SEARCH_DISPLAY_SECTIONS.find((s) => s.id === id)?.keys ?? null
}

/** Number of rows shown per display section in the typeahead dropdown. */
export const TYPEAHEAD_PER_GROUP = 3

/**
 * One section ready to render: its display id, label, the (possibly sliced)
 * items, and whether there were more than we're showing (drives "see all").
 */
export interface SearchGroupView {
  key: string
  label: string
  items: SearchResultItem[]
  hasMore: boolean
}

/**
 * Build the ordered, non-empty display sections for a results envelope. Items
 * from a section's underlying data keys are concatenated (so Users = authors
 * then teams).
 *
 * `perGroup` caps how many rows each section shows; when a section has more
 * items than that, `hasMore` is set so the caller can render a "see all"
 * affordance. Empty sections are omitted entirely (no empty headers).
 */
export function buildGroupViews(groups: SearchGroups, perGroup?: number): SearchGroupView[] {
  const views: SearchGroupView[] = []
  for (const section of SEARCH_DISPLAY_SECTIONS) {
    const all = section.keys.flatMap((k) => (groups[k] ?? []) as SearchResultItem[])
    if (all.length === 0) continue
    const items = perGroup === undefined ? all : all.slice(0, perGroup)
    views.push({
      key: section.id,
      label: section.label,
      items,
      hasMore: perGroup !== undefined && all.length > perGroup,
    })
  }
  return views
}

/**
 * Flatten the group views into the linear list of selectable rows, in render
 * order. The dropdown's `highlightedIndex` indexes into this list, so headers
 * (which are not selectable) are intentionally excluded.
 */
export function flattenResults(views: SearchGroupView[]): SearchResultItem[] {
  return views.flatMap((g) => g.items)
}

/** Full results route for the "see all" and submit-without-selection paths.
 *  `section` is a display-section id (see SEARCH_DISPLAY_SECTIONS). */
export function searchAllHref(query: string, section?: string): string {
  const params = new URLSearchParams({ q: query })
  if (section) params.set('type', section)
  return `/search?${params.toString()}`
}

/** A stable React key for a result row (ids/slugs are unique within a type). */
export function resultKey(item: SearchResultItem): string {
  switch (item.type) {
    case 'skill':
      return `skill:${item.skill_id}`
    case 'kit':
      return `kit:${item.kit_id}`
    case 'author':
      return `author:${item.username}`
    case 'team':
      return `team:${item.slug}`
    case 'doc':
      return `doc:${item.doc_id}`
  }
}
