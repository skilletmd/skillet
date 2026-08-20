// Activity-stream ingest + user-owned controls. The time-series behind
// retention, cohorts, funnels, and cross-vendor distribution (availability) - see migration 014 for
// the model. All paths hardcode `/api/v1/...` like the other account routes.
//
//   POST   /api/v1/events           - ingest a batch (account-bound; private mode drops)
//   GET    /api/v1/me/events        - the viewer's own recent activity (transparency)
//   DELETE /api/v1/me/events        - clear the viewer's activity
//   PUT    /api/v1/me/activity      - set the viewer's private-mode flag (opt-out)
import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { DatabaseSync } from '../db/sqlite-handle.js'
import { requireUser } from '../auth/middleware.js'
import {
  categoriesForSkillRefsPrisma,
  clearUserEventsPrisma,
  insertEventBatchPrisma,
  isActivityPrivatePrisma,
  listRouteUsageEventsPrisma,
  listUserEventsPrisma,
  setActivityPrivatePrisma,
} from '../lib/user-events.js'

const VALID_INITIATORS = new Set(['human', 'daemon', 'ci'])
const MAX_BATCH = 100
// Event names are lowercase dotted identifiers (sync, skill.route, publish, …).
// A charset grammar - not a fixed whitelist - keeps junk/injected names out
// without dropping legitimate new event types a future client adds.
const NAME_RE = /^[a-z][a-z0-9._-]{0,63}$/
// Route-event metadata grammars (shared with availability.ts; REF_RE + the
// MAX_META_VALUE bound are also enforced on the MCP direct-write path in
// mcp/record-usage.ts): a canonical skill ref and short slug values. A
// `skill.route` event whose fields don't match is dropped - the official client
// only ever produces conforming values, so this keeps the route stream clean
// without touching other event types' meta. Editing REF_RE changes MCP
// usage-recording validation too, not just ingest.
export const REF_RE = /^@?[a-z0-9][a-z0-9._/-]{0,200}$/i
const SLUG_RE = /^[a-z0-9][a-z0-9._-]{0,64}$/i

/** True if a route event's known meta fields conform; non-route events pass. */
function routeMetaOk(name: string, meta: Record<string, string | number | boolean> | null): boolean {
  if (name === 'skill.route') {
    return typeof meta?.['skill_ref'] === 'string' && REF_RE.test(meta['skill_ref'])
  }
  if (name === 'skill.route.invoke') {
    for (const k of ['command', 'runtime', 'source', 'surface'] as const) {
      const v = meta?.[k]
      if (v !== undefined && !(typeof v === 'string' && SLUG_RE.test(v))) return false
    }
    return true
  }
  return true
}

/** JSON.parse that never throws - a malformed stored row yields null, not a 500. */
function safeParseMeta(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}
const MAX_META_KEYS = 16
const MAX_META_KEY = 32
export const MAX_META_VALUE = 200

const SQLITE_REMOVED = 'sqlite registry store removed; use the *Prisma counterpart'

/**
 * Fail-closed stand-in for residual dual-path callers outside U4
 * (mcp/record-usage). MySQL uses {@link pruneUserEventsPrisma}.
 */
export function pruneUserEvents(_db: DatabaseSync, _userId: string): void {
  throw new Error(`${SQLITE_REMOVED}: pruneUserEventsPrisma`)
}

/**
 * Fail-closed stand-in for residual dual-path callers outside U4
 * (mcp/record-usage). MySQL uses {@link isActivityPrivatePrisma}.
 */
export function isActivityPrivate(_db: DatabaseSync, _userId: string): boolean {
  throw new Error(`${SQLITE_REMOVED}: isActivityPrivatePrisma`)
}

interface IncomingEvent {
  name?: string
  initiator?: string
  /** ISO-8601 string (what @skillet/core sends) or a numeric epoch (s or ms). */
  ts?: number | string
  meta?: Record<string, unknown>
}

/**
 * Normalize a client-provided event time to epoch **seconds** - the unit the
 * `events.ts` column uses (see the `unixepoch()` fallback on insert). Accepts an
 * ISO-8601 string (the CLI/desktop wire format) or a numeric epoch in seconds or
 * milliseconds; returns null for anything unparseable, so the insert falls back
 * to the server's receive time. Keeping one unit here is what makes ordering and
 * retention windows correct across every client.
 */
function toEpochSeconds(raw: number | string | undefined): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Disambiguate seconds vs milliseconds: ms epochs are ~1e12+, seconds ~1e9.
    return Math.floor(raw > 1e12 ? raw / 1000 : raw)
  }
  if (typeof raw === 'string') {
    const ms = Date.parse(raw)
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
  }
  return null
}

/**
 * Coerce a meta object to metadata only - short key/values, key count bounded,
 * string values length-capped at MAX_META_VALUE. This is a SIZE bound, not a
 * content grammar: a skill body or file (oversized) is dropped, but a short
 * string still passes. The "no task/prompt/reasoning" guarantee is enforced at
 * the source by the official client (see @skillet/core `sanitizeMetaValue`,
 * which slugifies every recorded value); this server cap is defense-in-depth.
 */
function sanitizeMeta(meta: unknown): Record<string, string | number | boolean> | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null
  const out: Record<string, string | number | boolean> = {}
  let keys = 0
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (keys >= MAX_META_KEYS) break
    if (key.length > MAX_META_KEY) continue
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
    else if (typeof value === 'boolean') out[key] = value
    else if (typeof value === 'string' && value.length <= MAX_META_VALUE) out[key] = value
    else continue // drop content-shaped / oversized values
    keys++
  }
  return keys > 0 ? out : null
}

function parseIncomingBatch(body: { events?: IncomingEvent[] } | undefined) {
  const batch = Array.isArray(body?.events) ? body!.events!.slice(0, MAX_BATCH) : []
  return batch
    .map((e) => {
      const name = typeof e.name === 'string' ? e.name : ''
      if (!NAME_RE.test(name)) return null
      const initiator = VALID_INITIATORS.has(e.initiator ?? '') ? e.initiator! : 'human'
      const meta = sanitizeMeta(e.meta)
      if (!routeMetaOk(name, meta)) return null
      const ts = toEpochSeconds(e.ts)
      return { name, initiator, meta, ts }
    })
    .filter(
      (
        r,
      ): r is {
        name: string
        initiator: string
        meta: Record<string, string | number | boolean> | null
        ts: number | null
      } => r != null,
    )
}

function aggregateRouteUsage(rows: Array<{ name: string; meta: string | null; ts: number }>) {
  const bySkill = new Map<string, { count: number; last_ts: number }>()
  const runtimes = new Set<string>()
  const routeTsCutoff = Math.floor(Date.now() / 1000) - 30 * 86_400
  const routeTs: number[] = []
  for (const r of rows) {
    const meta = safeParseMeta(r.meta)
    if (r.name === 'skill.route') {
      const ref = typeof meta?.['skill_ref'] === 'string' ? meta['skill_ref'] : null
      if (!ref) continue
      if (r.ts >= routeTsCutoff) routeTs.push(r.ts)
      const e = bySkill.get(ref)
      if (e) {
        e.count += 1
        if (r.ts > e.last_ts) e.last_ts = r.ts
      } else {
        bySkill.set(ref, { count: 1, last_ts: r.ts })
      }
    } else if (typeof meta?.['runtime'] === 'string') {
      runtimes.add(meta['runtime'])
    }
  }
  routeTs.sort((a, b) => a - b)
  return { bySkill, runtimes, routeTs }
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerEventRoutes(app: FastifyInstance, prisma?: PrismaClient): void {
  // POST /api/v1/events - ingest a batch from an account-bound client.
  app.post<{ Body: { events?: IncomingEvent[] } }>(
    '/api/v1/events',
    { preHandler: requireUser() },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const principal = req.principal!
      const userId =
        principal.class === 'session' || principal.class === 'device' ? principal.user_id : null
      const deviceId = principal.class === 'device' ? principal.device_id : null
      if (!userId) return reply.code(403).send({ error: 'user_token_required' })

      if (await isActivityPrivatePrisma(db, userId)) {
        return reply.send({ stored: 0, reason: 'private' })
      }
      const rows = parseIncomingBatch(req.body)
      if (rows.length > 0) {
        await insertEventBatchPrisma(db, userId, deviceId, rows)
      }
      return reply.send({ stored: rows.length })
    },
  )

  // GET /api/v1/me/events - the viewer's own recent events (transparency).
  app.get('/api/v1/me/events', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma)
    const userId = (req.principal as { user_id?: string }).user_id
    if (!userId) return reply.code(403).send({ error: 'user_token_required' })

    const recording = !(await isActivityPrivatePrisma(db, userId))
    const rows = await listUserEventsPrisma(db, userId, 100)
    return reply.send({
      recording,
      events: rows.map((r) => ({
        id: r.id,
        name: r.name,
        initiator: r.initiator,
        device_id: r.device_id,
        meta: safeParseMeta(r.meta),
        ts: r.ts,
      })),
    })
  })

  // DELETE /api/v1/me/events - clear the viewer's stream (user-owned data).
  app.delete('/api/v1/me/events', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma)
    const userId = (req.principal as { user_id?: string }).user_id
    if (!userId) return reply.code(403).send({ error: 'user_token_required' })
    const deleted = await clearUserEventsPrisma(db, userId)
    return reply.send({ deleted })
  })

  // PUT /api/v1/me/activity - set the viewer's private-mode flag (opt-out).
  app.put<{ Body: { private?: boolean } }>(
    '/api/v1/me/activity',
    { preHandler: requireUser() },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const userId = (req.principal as { user_id?: string }).user_id
      if (!userId) return reply.code(403).send({ error: 'user_token_required' })
      const priv = req.body?.private === true
      await setActivityPrivatePrisma(db, userId, priv)
      return reply.send({ private: priv })
    },
  )

  // GET /api/v1/me/route-usage - the viewer's own /skillet usage, aggregated over
  // ALL their route events (not the 100-row recent window), so the account UI's
  // per-skill counts are lifetime totals that match the CLI's `skillet usage`.
  app.get('/api/v1/me/route-usage', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma)
    const userId = (req.principal as { user_id?: string }).user_id
    if (!userId) return reply.code(403).send({ error: 'user_token_required' })

    const recording = !(await isActivityPrivatePrisma(db, userId))
    const rows = await listRouteUsageEventsPrisma(db, userId)
    const { bySkill, runtimes, routeTs } = aggregateRouteUsage(rows)
    const categoryByRef = await categoriesForSkillRefsPrisma(db, [...bySkill.keys()])
    const skills = [...bySkill.entries()]
      .map(([skill_ref, v]) => ({
        skill_ref,
        count: v.count,
        last_ts: v.last_ts,
        category: categoryByRef.get(skill_ref) ?? null,
      }))
      .sort(
        (a, b) => b.count - a.count || b.last_ts - a.last_ts || a.skill_ref.localeCompare(b.skill_ref),
      )
    return reply.send({
      recording,
      skills,
      runtimes: [...runtimes].sort(),
      route_ts: routeTs,
    })
  })
}
