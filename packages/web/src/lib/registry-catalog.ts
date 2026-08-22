'use cache'

import 'server-only'

import { cacheLife, cacheTag } from 'next/cache'
import type { SkillCatalogResponse } from './types'
import type { UsedByFace } from '@/components/directory-card'
import { usedByFacesFromWire } from './used-by'
import { RegistryUnavailableError, logRegistryDegrade } from './registry-errors'
import { REGISTRY_API } from './registry-prefix'
import { buildMockCatalog, REGISTRY_BASE_URL } from './registry-mock'
import { mapDiscoverFeedEvents, type DiscoverFeedResponse } from './registry-feed-mapper'
import type { FeedResult } from './registry-feed-types'
import { categoryKeysForSection, sectionFromSlug } from './categories'
import { catalogFetchKey, runCatalogFetch } from './catalog-fetch-gate'
import { catalogRedisGet, catalogRedisSet } from './catalog-redis-cache'
import {
  browseSsrLog,
  browseSsrProbeClock,
  browseSsrRedisConfigSummary,
  browseSsrSafeUrl,
  isBrowseSsrProbeEnabled,
} from './browse-ssr-probe'

export interface SkillCatalogParams {
  limit?: number
  offset?: number
  q?: string
  category?: string
  sort?: string
}

export interface KitCatalogEntry {
  id: string
  owner: string
  /** The kit owner's avatar photo, shown beside @owner in the card byline.
   *  Null when the owner has none; the card then falls back to an identicon. */
  ownerAvatarUrl: string | null
  name: string
  slug: string
  description: string | null
  skillCount: number
  subscriberCount: number
  category: string | null
  skillRefs?: string[]
  skillCategories?: (string | null)[]
  /** Real "used by" faces (recent subscribers) for the card facepile; never
   *  fabricated. Empty when the registry returns no roster. */
  usedBy?: UsedByFace[]
}

export interface PersonCatalogEntry {
  handle: string
  name: string
  avatarUrl: string | null
  bio: string | null
  followers: number
  following?: number
  publicSkills: number
  kits?: number
  totalInstalls: number
  category: string | null
  categories: string[]
  viewerFollows: boolean
}

export interface DirectoryCatalog<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

interface DiscoverParams {
  limit?: number
  offset?: number
  q?: string
  category?: string
  sort?: string
}

function catalogTags(prefix: string, params: DiscoverParams & SkillCatalogParams): string[] {
  return [
    `catalog:${prefix}`,
    `catalog:${prefix}:${params.limit ?? 24}:${params.offset ?? 0}:${params.q?.trim() || '-'}:${params.category?.trim() || '-'}:${params.sort?.trim() || '-'}`,
  ]
}

// A section landing (e.g. /browse/creative) threads its slug as the category so
// every web-side URL stays a clean single segment; only here, at the registry
// boundary, does it expand to the section's category keys. The registry accepts
// the resulting comma-separated list as an IN filter.
function categoryFilter(category: string | undefined): string {
  const trimmed = category?.trim()
  if (!trimmed) return ''
  const section = sectionFromSlug(trimmed)
  return section ? categoryKeysForSection(section).join(',') : trimmed
}

function discoverSearch(params: DiscoverParams): URLSearchParams {
  const search = new URLSearchParams()
  search.set('limit', String(params.limit ?? 24))
  search.set('offset', String(params.offset ?? 0))
  const q = params.q?.trim()
  const category = categoryFilter(params.category)
  const sort = params.sort?.trim()
  if (q) search.set('q', q)
  if (category) search.set('category', category)
  if (sort) search.set('sort', sort)
  return search
}

function registryFetchFailedDuringBuild(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build'
}

let browseOriginLogged = false

function logBrowseOriginOnce(): void {
  if (browseOriginLogged || !isBrowseSsrProbeEnabled()) return
  browseOriginLogged = true
  browseSsrLog('origin', {
    registry_base: REGISTRY_BASE_URL ? browseSsrSafeUrl(REGISTRY_BASE_URL) : '(empty)',
    registry_url_env: process.env.REGISTRY_URL ?? '(unset)',
    public_url_env: process.env.NEXT_PUBLIC_REGISTRY_PUBLIC_URL ?? '(unset)',
    legacy_public: process.env.NEXT_PUBLIC_REGISTRY_URL ?? '(unset)',
    concurrency: process.env.SKILLET_CATALOG_FETCH_CONCURRENCY ?? '3',
    timeout_ms: process.env.SKILLET_CATALOG_FETCH_TIMEOUT_MS ?? '4000',
    ...browseSsrRedisConfigSummary(),
  })
}

/** Timed outbound registry fetch for browse SSR probe logs. */
async function probedCatalogFetch(
  kind: string,
  url: string,
  init: RequestInit & { signal: AbortSignal },
): Promise<Response> {
  logBrowseOriginOnce()
  const started = browseSsrProbeClock()
  browseSsrLog('fetch_start', { kind, url: browseSsrSafeUrl(url) })
  try {
    const res = await fetch(url, init)
    browseSsrLog('fetch_done', {
      kind,
      url: browseSsrSafeUrl(url),
      status: res.status,
      ms: started ? browseSsrProbeClock() - started : undefined,
    })
    return res
  } catch (cause) {
    browseSsrLog('fetch_throw', {
      kind,
      url: browseSsrSafeUrl(url),
      ms: started ? browseSsrProbeClock() - started : undefined,
      error: cause instanceof Error ? cause.message : String(cause),
    })
    throw cause
  }
}

function emptySkillCatalog(limit: number, offset: number): SkillCatalogResponse {
  return { skills: [], total: 0, limit, offset }
}

function emptyDirectoryCatalog<T>(limit: number, offset: number): DirectoryCatalog<T> {
  return { items: [], total: 0, limit, offset }
}

/** Cached public skill catalog — `GET /v1/skills`. */
export async function getSkillCatalog(
  params: SkillCatalogParams = {},
): Promise<SkillCatalogResponse> {
  cacheLife('minutes')
  // Same tags govern the `use cache` entry AND the inner fetch's Data Cache entry,
  // so a write-path revalidateTag flushes both layers (not just the outer one).
  const tags = catalogTags('skills', params)
  for (const tag of tags) cacheTag(tag)

  const limit = params.limit ?? 24
  const offset = params.offset ?? 0
  const q = params.q?.trim() ?? ''

  if (!REGISTRY_BASE_URL) return buildMockCatalog({ limit, offset, q })

  const search = discoverSearch(params)
  const url = `${REGISTRY_BASE_URL}${REGISTRY_API}/skills?${search.toString()}`
  const key = catalogFetchKey(`${REGISTRY_API}/skills`, search.toString())

  const warm = await catalogRedisGet<SkillCatalogResponse>(key)
  if (warm) {
    browseSsrLog('catalog_outcome', { kind: 'skills', outcome: 'redis_hit_warm' })
    return warm
  }

  // Singleflight + concurrency gate + abort budget around fetch+parse.
  // Note: the warm Redis get above is intentionally outside this abort budget
  // today — probe redis_connect/redis_get spans to see if that path hangs.
  return runCatalogFetch(key, async (signal) => {
    const again = await catalogRedisGet<SkillCatalogResponse>(key)
    if (again) {
      browseSsrLog('catalog_outcome', { kind: 'skills', outcome: 'redis_hit_inner' })
      return again
    }

    let res: Response
    try {
      res = await probedCatalogFetch('skills', url, {
        signal,
        next: { revalidate: 60, tags },
      })
    } catch (cause) {
      browseSsrLog('catalog_outcome', {
        kind: 'skills',
        outcome: cause instanceof DOMException && cause.name === 'AbortError' ? 'abort' : 'fetch_error',
        error: cause instanceof Error ? cause.message : String(cause),
      })
      if (registryFetchFailedDuringBuild()) return emptySkillCatalog(limit, offset)
      logRegistryDegrade('skill catalog fetch failed', cause)
      const localDev =
        process.env.NODE_ENV === 'development' && /localhost|127\.0\.0\.1/.test(REGISTRY_BASE_URL)
      throw new RegistryUnavailableError(
        localDev
          ? 'Could not reach the skill registry. Ensure `pnpm dev` is running from the repo root and @skillet/registry started (requires Node 24 LTS for node:sqlite).'
          : 'Could not reach the skill registry.',
        { cause },
      )
    }
    if (!res.ok) {
      browseSsrLog('catalog_outcome', {
        kind: 'skills',
        outcome: 'http_error',
        status: res.status,
      })
      if (registryFetchFailedDuringBuild()) return emptySkillCatalog(limit, offset)
      logRegistryDegrade(`skill catalog responded ${res.status}`)
      throw new RegistryUnavailableError(`The skill registry responded ${res.status}.`)
    }
    const body = (await res.json()) as SkillCatalogResponse
    await catalogRedisSet(key, body)
    browseSsrLog('catalog_outcome', { kind: 'skills', outcome: 'fetch_ok' })
    return body
  })
}

export async function getKitCatalog(
  params: DiscoverParams = {},
): Promise<DirectoryCatalog<KitCatalogEntry>> {
  cacheLife('minutes')
  const tags = catalogTags('kits', params)
  for (const tag of tags) cacheTag(tag)

  const limit = params.limit ?? 24
  const offset = params.offset ?? 0
  if (!REGISTRY_BASE_URL) return { items: [], total: 0, limit, offset }

  const search = discoverSearch(params)
  const url = `${REGISTRY_BASE_URL}${REGISTRY_API}/discover/kits?${search.toString()}`
  const key = catalogFetchKey(`${REGISTRY_API}/discover/kits`, search.toString())

  type KitPage = DirectoryCatalog<KitCatalogEntry>
  const warm = await catalogRedisGet<KitPage>(key)
  if (warm) {
    browseSsrLog('catalog_outcome', { kind: 'kits', outcome: 'redis_hit_warm' })
    return warm
  }

  return runCatalogFetch(key, async (signal) => {
    const again = await catalogRedisGet<KitPage>(key)
    if (again) {
      browseSsrLog('catalog_outcome', { kind: 'kits', outcome: 'redis_hit_inner' })
      return again
    }

    let res: Response
    try {
      res = await probedCatalogFetch('kits', url, { signal, next: { revalidate: 60, tags } })
    } catch (cause) {
      browseSsrLog('catalog_outcome', {
        kind: 'kits',
        outcome: cause instanceof DOMException && cause.name === 'AbortError' ? 'abort' : 'fetch_error',
        error: cause instanceof Error ? cause.message : String(cause),
      })
      if (registryFetchFailedDuringBuild()) return emptyDirectoryCatalog(limit, offset)
      logRegistryDegrade('directory catalog fetch failed', cause)
      throw new RegistryUnavailableError('Could not reach the skill registry.', { cause })
    }
    if (!res.ok) {
      browseSsrLog('catalog_outcome', {
        kind: 'kits',
        outcome: 'http_error',
        status: res.status,
      })
      if (registryFetchFailedDuringBuild()) return emptyDirectoryCatalog(limit, offset)
      logRegistryDegrade(`directory catalog responded ${res.status}`)
      throw new RegistryUnavailableError(`The skill registry responded ${res.status}.`)
    }
    const body = (await res.json()) as Record<string, unknown>
    const rows = Array.isArray(body.kits) ? (body.kits as Record<string, unknown>[]) : []
    const page: KitPage = {
      items: rows.map((r) => ({
        id: String(r.id),
        owner: String(r.owner),
        ownerAvatarUrl: (r.owner_avatar_url as string | null) ?? null,
        name: String(r.name),
        slug: String(r.slug ?? ''),
        description: (r.description as string | null) ?? null,
        skillCount: Number(r.skill_count ?? 0),
        subscriberCount: Number(r.subscriber_count ?? 0),
        category: (r.category as string | null) ?? null,
        skillRefs: ((r.skill_ids as string[] | undefined) ?? []).map((id) => id.replace(':', '/')),
        skillCategories: (r.skill_categories as (string | null)[] | undefined) ?? [],
        usedBy: usedByFacesFromWire(r.used_by),
      })),
      total: typeof body.total === 'number' ? body.total : rows.length,
      limit: typeof body.limit === 'number' ? body.limit : limit,
      offset: typeof body.offset === 'number' ? body.offset : offset,
    }
    await catalogRedisSet(key, page)
    browseSsrLog('catalog_outcome', { kind: 'kits', outcome: 'fetch_ok' })
    return page
  })
}

export async function getPeopleCatalog(
  params: DiscoverParams = {},
): Promise<DirectoryCatalog<PersonCatalogEntry>> {
  cacheLife('minutes')
  const tags = catalogTags('people', params)
  for (const tag of tags) cacheTag(tag)

  const limit = params.limit ?? 24
  const offset = params.offset ?? 0
  if (!REGISTRY_BASE_URL) return { items: [], total: 0, limit, offset }

  const search = discoverSearch(params)
  const url = `${REGISTRY_BASE_URL}${REGISTRY_API}/discover/people?${search.toString()}`
  const key = catalogFetchKey(`${REGISTRY_API}/discover/people`, search.toString())

  type PeoplePage = DirectoryCatalog<PersonCatalogEntry>
  const warm = await catalogRedisGet<PeoplePage>(key)
  if (warm) {
    browseSsrLog('catalog_outcome', { kind: 'people', outcome: 'redis_hit_warm' })
    return warm
  }

  return runCatalogFetch(key, async (signal) => {
    const again = await catalogRedisGet<PeoplePage>(key)
    if (again) {
      browseSsrLog('catalog_outcome', { kind: 'people', outcome: 'redis_hit_inner' })
      return again
    }

    let res: Response
    try {
      res = await probedCatalogFetch('people', url, { signal, next: { revalidate: 60, tags } })
    } catch (cause) {
      browseSsrLog('catalog_outcome', {
        kind: 'people',
        outcome: cause instanceof DOMException && cause.name === 'AbortError' ? 'abort' : 'fetch_error',
        error: cause instanceof Error ? cause.message : String(cause),
      })
      if (registryFetchFailedDuringBuild()) return emptyDirectoryCatalog(limit, offset)
      logRegistryDegrade('directory catalog fetch failed', cause)
      throw new RegistryUnavailableError('Could not reach the skill registry.', { cause })
    }
    if (!res.ok) {
      browseSsrLog('catalog_outcome', {
        kind: 'people',
        outcome: 'http_error',
        status: res.status,
      })
      if (registryFetchFailedDuringBuild()) return emptyDirectoryCatalog(limit, offset)
      logRegistryDegrade(`directory catalog responded ${res.status}`)
      throw new RegistryUnavailableError(`The skill registry responded ${res.status}.`)
    }
    const body = (await res.json()) as Record<string, unknown>
    const rows = Array.isArray(body.people) ? (body.people as Record<string, unknown>[]) : []
    const page: PeoplePage = {
      items: rows.map((r) => ({
        handle: String(r.handle),
        name: String(r.name),
        avatarUrl: (r.avatar_url as string | null) ?? null,
        bio: (r.bio as string | null) ?? null,
        followers: Number(r.followers ?? 0),
        following: r.following != null ? Number(r.following) : undefined,
        publicSkills: Number(r.public_skills ?? 0),
        kits: r.kits != null ? Number(r.kits) : undefined,
        totalInstalls: Number(r.total_installs ?? 0),
        category: (r.category as string | null) ?? null,
        categories: Array.isArray(r.categories) ? (r.categories as unknown[]).map(String) : [],
        viewerFollows: false,
      })),
      total: typeof body.total === 'number' ? body.total : rows.length,
      limit: typeof body.limit === 'number' ? body.limit : limit,
      offset: typeof body.offset === 'number' ? body.offset : offset,
    }
    await catalogRedisSet(key, page)
    browseSsrLog('catalog_outcome', { kind: 'people', outcome: 'fetch_ok' })
    return page
  })
}

export async function getKitsForSkill(author: string, slug: string): Promise<KitCatalogEntry[]> {
  cacheLife('minutes')
  const tags = ['skill-kits', `skill-kits:${author}:${slug}`]
  for (const tag of tags) cacheTag(tag)

  if (!REGISTRY_BASE_URL) return []
  let res: Response
  try {
    res = await fetch(
      `${REGISTRY_BASE_URL}${REGISTRY_API}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/kits`,
      { next: { revalidate: 60, tags } },
    )
  } catch (cause) {
    // Secondary section on the skill page — degrade to an empty kit list rather
    // than take the page down, but leave a trace of the outage.
    logRegistryDegrade(`kits-for-skill fetch failed: ${author}/${slug}`, cause)
    return []
  }
  if (!res.ok) {
    if (res.status !== 404) logRegistryDegrade(`kits-for-skill responded ${res.status}: ${author}/${slug}`)
    return []
  }
  const body = (await res.json().catch(() => null)) as { kits?: Record<string, unknown>[] } | null
  const rows = Array.isArray(body?.kits) ? body!.kits : []
  return rows.map((r) => ({
    id: String(r.id),
    owner: String(r.owner),
    ownerAvatarUrl: (r.owner_avatar_url as string | null) ?? null,
    name: String(r.name),
    slug: String(r.slug ?? ''),
    description: null,
    category: (r.category as string | null) ?? null,
    skillCount: Number(r.skill_count ?? 0),
    subscriberCount: Number(r.subscriber_count ?? 0),
    skillRefs: ((r.skill_ids as string[] | undefined) ?? []).map((id) => id.replace(':', '/')),
    skillCategories: (r.skill_categories as (string | null)[] | undefined) ?? [],
  }))
}

/** Anonymous discover feed — `GET /v1/discover/feed`. */
export async function getDiscoverFeedCached(): Promise<FeedResult | null> {
  cacheLife('minutes')
  cacheTag('discover-feed')

  if (!REGISTRY_BASE_URL) return null
  try {
    const res = await fetch(`${REGISTRY_BASE_URL}${REGISTRY_API}/discover/feed`, {
      next: { revalidate: 60, tags: ['discover-feed'] },
    })
    if (!res.ok) {
      if (res.status !== 404) logRegistryDegrade(`discover feed responded ${res.status}`)
      return null
    }
    const live = (await res.json()) as DiscoverFeedResponse
    return {
      events: mapDiscoverFeedEvents(live.events),
      followingCount: live.following_count ?? 0,
      view: 'discover',
      nextCursor: live.next_offset ?? null,
    }
  } catch (cause) {
    logRegistryDegrade('discover feed fetch failed', cause)
    return null
  }
}
