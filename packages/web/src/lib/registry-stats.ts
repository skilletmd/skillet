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
  /** Skills saved by users: distinct (user, skill) pairs, however the save
   *  happened (added to one of their kits, or brought in by a kit or author
   *  subscription). Counts the person once, unlike `installs`, which counts
   *  every machine that later materializes the skill. */
  saves: number
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
  /** picks + summons: every time a skill was routed to an agent, installed or
   *  not. The two are counted on different paths, so an MCP summon lands in
   *  both (no user on the summon side to dedupe against). */
  routed: number
  /** `routed`, cumulative by month, aligned index-for-index to `months`. */
  routedSeries: number[]
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
    saves: 0,
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
    saves: [],
    versions: [],
    subscriptions: [],
    follows: [],
  },
  categories: [],
  routes: {
    invocations: 0,
    summons: 0,
    picks: 0,
    routed: 0,
    routedSeries: [],
    topPickedSkills: [],
    invocationsByRuntime: [],
  },
}

const TOTAL_KEYS = [
  'users',
  'creators',
  'skills',
  'networkSkills',
  'kits',
  'installs',
  'saves',
  'versions',
  'subscriptions',
  'follows',
] as const

/**
 * One count off the wire. A registry that predates a field — or an older one
 * still serving during a rolling deploy — simply omits it, and an `undefined`
 * handed to Intl.NumberFormat prints a literal "NaN" on the page (which is how
 * the Summons card read). Every number the stats page shows passes through
 * here, so a missing field degrades to 0 instead.
 */
function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : 0
}

function nums(value: unknown): number[] {
  return Array.isArray(value) ? value.map(num) : []
}

/** Fill the whole payload from EMPTY, coercing every count. The response is
 *  network data, not a typed value, so nothing is trusted verbatim. */
function normalize(body: DeepPartial<RegistryStats>): RegistryStats {
  const totals = {} as RegistryTotals
  const series = {} as MetricSeries
  for (const key of TOTAL_KEYS) {
    totals[key] = num(body.totals?.[key])
    series[key] = nums(body.series?.[key])
  }

  const routes = body.routes
  return {
    totals,
    series,
    months: Array.isArray(body.months) ? body.months.map((m) => String(m)) : [],
    growth: Array.isArray(body.growth)
      ? body.growth.map((g) => ({
          month: String(g?.month ?? ''),
          skills: num(g?.skills),
          users: num(g?.users),
        }))
      : [],
    categories: Array.isArray(body.categories)
      ? body.categories.map((c) => ({
          key: String(c?.key ?? ''),
          skills: num(c?.skills),
          installs: num(c?.installs),
        }))
      : [],
    routes: {
      invocations: num(routes?.invocations),
      picks: num(routes?.picks),
      summons: num(routes?.summons),
      routed: num(routes?.routed),
      routedSeries: nums(routes?.routedSeries),
      topPickedSkills: Array.isArray(routes?.topPickedSkills)
        ? routes.topPickedSkills.map((s) => ({
            skillRef: String(s?.skillRef ?? ''),
            picks: num(s?.picks),
          }))
        : [],
      invocationsByRuntime: Array.isArray(routes?.invocationsByRuntime)
        ? routes.invocationsByRuntime.map((r) => ({
            runtime: String(r?.runtime ?? ''),
            count: num(r?.count),
          }))
        : [],
    },
  }
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U> ? Array<DeepPartial<U>> : DeepPartial<T[K]>
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
    return normalize((await res.json()) as DeepPartial<RegistryStats>)
  } catch (cause) {
    // Build and deploy must succeed when the registry is down or missing /stats.
    logRegistryDegrade('stats fetch failed', cause)
    return EMPTY
  }
}
