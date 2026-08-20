import { registrySkillApi } from '@/lib/registry-proxy'

export type SearchGroupKey = 'skills' | 'kits' | 'authors' | 'teams' | 'docs'

export interface SearchSkillResult {
  type: 'skill'
  skill_id: string
  author: string
  slug: string
  description: string | null
  install_count: number
  /** Absent on older registry responses; the kit picker treats missing as public. */
  visibility?: 'public' | 'private'
  /** Browse category key; drives the cover art. Absent on older registries. */
  category?: string | null
  url: string
  score: number
}

export interface SearchKitResult {
  type: 'kit'
  kit_id: string
  owner: string
  name: string
  description: string | null
  /** Member skills' categories; drives the cover art. Absent on older registries. */
  skill_categories?: (string | null)[]
  /** Only the owner/members see a private kit in results; absent on older registries (treat as public). */
  visibility?: 'public' | 'private'
  url: string
  score: number
}

export interface SearchAuthorResult {
  type: 'author'
  username: string
  name: string
  avatar_url: string | null
  url: string
  score: number
}

export interface SearchTeamResult {
  type: 'team'
  slug: string
  name: string
  url: string
  score: number
}

export interface SearchDocResult {
  type: 'doc'
  doc_id: string
  title: string
  section: string
  snippet: string | null
  url: string
  score: number
}

export type SearchResultItem =
  | SearchSkillResult
  | SearchKitResult
  | SearchAuthorResult
  | SearchTeamResult
  | SearchDocResult

export interface SearchGroups {
  skills?: SearchSkillResult[]
  kits?: SearchKitResult[]
  authors?: SearchAuthorResult[]
  teams?: SearchTeamResult[]
  docs?: SearchDocResult[]
}

export interface SearchResponse {
  query: string
  groups: SearchGroups
}

export interface SearchOptions {
  types?: SearchGroupKey[]
  limit?: number
  signal?: AbortSignal
}

/** The registry-backed groups (skills/kits/authors/teams) via the Next proxy. */
async function fetchRegistryGroups(
  query: string,
  registryTypes: SearchGroupKey[],
  opts: SearchOptions,
): Promise<SearchGroups> {
  const params = new URLSearchParams({ q: query })
  if (registryTypes.length > 0) params.set('types', registryTypes.join(','))
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))

  const res = await fetch(`${registrySkillApi('search')}?${params.toString()}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
    signal: opts.signal,
  })
  if (!res.ok) throw new Error(`search_failed:${res.status}`)
  const body = (await res.json()) as Partial<SearchResponse>
  return body.groups ?? {}
}

/** Docs are searched web-side (the registry can't see the markdown) via a local
 *  Next route, so the docs group is fetched here and merged in. */
async function fetchDocResults(query: string, opts: SearchOptions): Promise<SearchDocResult[]> {
  const params = new URLSearchParams({ q: query })
  if (opts.limit !== undefined) params.set('limit', String(opts.limit))
  const res = await fetch(`/api/search/docs?${params.toString()}`, {
    headers: { accept: 'application/json' },
    signal: opts.signal,
  })
  if (!res.ok) throw new Error(`docs_search_failed:${res.status}`)
  const body = (await res.json()) as { docs?: SearchDocResult[] }
  return Array.isArray(body.docs) ? body.docs : []
}

/** Client-only universal search. Registry groups and the web-local docs group
 *  are fetched in parallel and merged into one envelope, so the typeahead and
 *  the full results page get docs with no per-surface wiring. */
export async function searchUniversal(
  q: string,
  opts: SearchOptions = {},
): Promise<SearchResponse> {
  const query = q.trim()
  const requestedTypes = opts.types ?? []
  if (query === '') {
    const groups: SearchGroups = {}
    for (const t of requestedTypes) groups[t] = []
    return { query: '', groups }
  }

  // 'docs' is web-local; the registry never receives it. An empty requested set
  // means "all groups", which includes docs.
  const wantDocs = requestedTypes.length === 0 || requestedTypes.includes('docs')
  const registryTypes = requestedTypes.filter((t) => t !== 'docs')
  const onlyDocs = requestedTypes.length > 0 && registryTypes.length === 0

  const [registryGroups, docs] = await Promise.all([
    onlyDocs ? Promise.resolve<SearchGroups>({}) : fetchRegistryGroups(query, registryTypes, opts),
    wantDocs
      ? // A real abort must propagate; any other docs failure degrades gracefully
        // (the rest of search still returns) so docs never break universal search.
        fetchDocResults(query, opts).catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') throw err
          return null
        })
      : Promise.resolve<SearchDocResult[] | null>(null),
  ])

  const groups: SearchGroups = { ...registryGroups }
  if (docs && docs.length > 0) groups.docs = docs
  return { query, groups }
}
