'use cache'

import 'server-only'

import { cacheLife, cacheTag } from 'next/cache'
import { REGISTRY_API } from './registry-prefix'
import { REGISTRY_BASE_URL } from './registry-mock'
import { logRegistryDegrade } from './registry-errors'

// Registry-wide public aggregates for the /stats page — `GET /api/v1/stats`.
// Cached like the catalogs (minutes), so the page is cheap to serve and the
// numbers refresh on their own.

export interface RegistryTotals {
  users: number
  creators: number
  skills: number
  /** All skills on the network, private included — a bare aggregate, never sliced. */
  networkSkills: number
  kits: number
  installs: number
  versions: number
  subscriptions: number
  follows: number
}

export interface GrowthPoint {
  /** `YYYY-MM`. */
  month: string
  /** Cumulative skills on the network (public + private) at month end. */
  skills: number
  /** Cumulative registered users at month end. */
  users: number
}

export interface CategoryStat {
  key: string
  skills: number
  installs: number
}

export interface RouteStats {
  invocations: number
  summons: number
  picks: number
  topPickedSkills: Array<{
    skillRef: string
    picks: number
  }>
  invocationsByRuntime?: Array<{
    runtime: string
    count: number
  }>
}

/** Cumulative monthly series per metric, aligned index-for-index to `months`.
 *  Powers the per-card sparklines. */
export type MetricSeries = Record<keyof RegistryTotals, number[]>

export interface RegistryStats {
  totals: RegistryTotals
  growth: GrowthPoint[]
  /** Shared `YYYY-MM` axis for every series. */
  months: string[]
  series: MetricSeries
  categories: CategoryStat[]
  routes: RouteStats
}

const EMPTY: RegistryStats = {
  totals: {
    users: 0,
    creators: 0,
    skills: 0,
    networkSkills: 0,
    kits: 0,
    installs: 0,
    versions: 0,
    subscriptions: 0,
    follows: 0,
  },
  growth: [],
  months: [],
  series: {
    users: [],
    creators: [],
    skills: [],
    networkSkills: [],
    kits: [],
    installs: [],
    versions: [],
    subscriptions: [],
    follows: [],
  },
  categories: [],
  routes: {
    invocations: 0,
    summons: 0,
    picks: 0,
    topPickedSkills: [],
    invocationsByRuntime: [],
  },
}

export async function getRegistryStats(): Promise<RegistryStats> {
  cacheLife('minutes')
  cacheTag('stats')

  if (!REGISTRY_BASE_URL) return EMPTY

  try {
    const res = await fetch(`${REGISTRY_BASE_URL}${REGISTRY_API}/stats`, {
      next: { revalidate: 300, tags: ['stats'] },
    })
    if (!res.ok) {
      if (res.status !== 404) logRegistryDegrade(`stats responded ${res.status}`)
      return EMPTY
    }
    const body = (await res.json()) as RegistryStats
    return {
      ...body,
      routes: body.routes ?? EMPTY.routes,
    }
  } catch (cause) {
    // Build and deploy must succeed when the registry is down or missing /stats.
    logRegistryDegrade('stats fetch failed', cause)
    return EMPTY
  }
}
