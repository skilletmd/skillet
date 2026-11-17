// The merges a computer writes for the kit map (kit map onboarding, KTD12,
// KTD13, KTD14).
//
//   GET /api/v1/map-merges        the caller's merges: a computer sees its own, the web every one on the account
//   GET /api/v1/map-merges/:id    one merge, with its brief, its blind rounds and the sources it credits
//   PUT /api/v1/map-merges/:id    the computer a merge change targets reports where that merge is
//
// One record per merge change (kit_map_changes, kind `merge`), keyed by the
// change's id; its job and originals always come from the change, never from a
// report. The computer writes the merge with the person's own AI tool and
// reports `writing`, then `ready` with the brief and one round per original,
// or `failed` with why, or `out-of-date`. A ready report names a merged skill
// the account already backs up as a merge, and that backup holds the sources
// it credits. A merge the person picked, or one already in place, is never
// moved back by a report. A merge change no computer has reported on lists as
// `waiting`. Every shape is `@skillet/protocol/kit-map`'s, and what goes out is
// exactly what its parser reads back. Nothing here holds a path.

import type { FastifyInstance } from 'fastify'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  KIT_MAP_MERGE_MAX_SOURCES,
  parseKitMapMerge,
  parseKitMapMergeReport,
  parseKitMapPendingChange,
  type KitMapMerge,
  type KitMapMergeReport,
} from '@skillet/protocol/kit-map'
import { requireClass, requireUser, type Principal } from '../auth/middleware.js'

/** Twelve rounds of two samples at the protocol's cap, escaped as JSON, with room to spare. */
const REPORT_BODY_LIMIT = 8 * 1024 * 1024
/** Statuses only the person (the pick) or a replace moves a merge into, and no report moves it out of. */
const LOCKED = ['picked', 'applied']

interface MergeRow {
  id: string
  device_id: string | null
  job: string
  keys_json: string
  status: string
  reason: string | null
  merged_hash: string | null
  created_at: number
  updated_at: number
}

interface ChangeRow {
  id: string
  device_id: string | null
  version: number
  body_json: string
  created_at: number
  acknowledged_at: number | null
}

const ROW_SELECT = {
  id: true,
  device_id: true,
  job: true,
  keys_json: true,
  status: true,
  reason: true,
  merged_hash: true,
  created_at: true,
  updated_at: true,
} as const

const CHANGE_SELECT = {
  id: true,
  device_id: true,
  version: true,
  body_json: true,
  created_at: true,
  acknowledged_at: true,
} as const

const notFound = { error: 'merge_not_found', message: 'No merge with this id for this account or computer.' }

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  return prisma
}

function userIdOf(principal: Principal): string {
  return (principal as { user_id: string }).user_id
}

function parseJson(raw: string | null): unknown {
  if (raw == null) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

/** A merge change as the protocol reads it, or null when the row is not a merge it can read. */
function mergeChangeOf(row: ChangeRow): { job: string; keys: string[] } | null {
  const body = parseJson(row.body_json)
  const change = parseKitMapPendingChange({
    ...(typeof body === 'object' && body !== null ? body : {}),
    id: row.id,
    kind: 'merge',
    device: row.device_id,
    version: row.version,
  })
  return change?.kind === 'merge' ? { job: change.job, keys: change.keys } : null
}

/** A merge change no computer reported on yet: waiting for the computer. */
function waitingOf(row: ChangeRow): KitMapMerge | null {
  const change = mergeChangeOf(row)
  if (!change) return null
  return parseKitMapMerge({ id: row.id, device: row.device_id, job: change.job, keys: change.keys, status: 'waiting', updatedAt: row.created_at })
}

/** The list form: where the merge is, with no brief, rounds or sources. */
function listWire(row: MergeRow): Record<string, unknown> {
  return {
    id: row.id,
    device: row.device_id,
    job: row.job,
    keys: parseJson(row.keys_json),
    status: row.status,
    ...(row.reason != null ? { reason: row.reason } : {}),
    ...(row.merged_hash != null ? { merged: row.merged_hash } : {}),
    updatedAt: row.updated_at,
  }
}

export function registerMapMergeRoutes(app: FastifyInstance, prismaArg?: PrismaClient): void {
  const prisma =
    prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined)

  /** A computer sees its own merges; the web sees every one on the account. */
  const scopeOf = (principal: Principal) =>
    principal.class === 'device' ? { user_id: userIdOf(principal), device_id: principal.device_id } : { user_id: userIdOf(principal) }

  app.get('/api/v1/map-merges', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma)
    const scope = scopeOf(req.principal!)
    const rows = await db.map_merges.findMany({ where: scope, select: ROW_SELECT })
    const reported = new Set(rows.map((row) => row.id))
    const open = await db.kit_map_changes.findMany({
      where: { ...scope, kind: 'merge', acknowledged_at: null },
      select: CHANGE_SELECT,
    })
    const merges: Array<{ merge: KitMapMerge; created: number }> = []
    for (const row of rows) {
      const merge = parseKitMapMerge(listWire(row))
      if (merge) merges.push({ merge, created: row.created_at })
      else req.log.error({ id: row.id }, 'map merge row does not read as a merge')
    }
    for (const row of open) {
      if (reported.has(row.id)) continue
      const merge = waitingOf(row)
      if (merge) merges.push({ merge, created: row.created_at })
    }
    merges.sort((a, b) => a.created - b.created || a.merge.id.localeCompare(b.merge.id))
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ merges: merges.map((m) => m.merge) })
  })

  app.get<{ Params: { id: string } }>('/api/v1/map-merges/:id', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma)
    const scope = scopeOf(req.principal!)
    const id = req.params.id
    reply.header('Cache-Control', 'private, no-store')
    const row = await db.map_merges.findFirst({
      where: { ...scope, id },
      select: { ...ROW_SELECT, brief: true, rounds_json: true },
    })
    if (!row) {
      const change = await db.kit_map_changes.findFirst({
        where: { ...scope, id, kind: 'merge', acknowledged_at: null },
        select: CHANGE_SELECT,
      })
      const merge = change ? waitingOf(change) : null
      return merge ? reply.send(merge) : reply.code(404).send(notFound)
    }
    const base = listWire(row)
    const written = row.brief != null && row.rounds_json != null ? { brief: row.brief, rounds: parseJson(row.rounds_json) } : {}
    let sources: unknown
    if (row.merged_hash != null) {
      // KTD14: the merged skill's sources live with its backup.
      const backup = await db.skill_backups.findUnique({
        where: { user_id_hash: { user_id: scope.user_id, hash: row.merged_hash } },
        select: { origin: true, sources: true },
      })
      if (backup?.origin === 'merge') sources = parseJson(backup.sources)
    }
    const merge =
      parseKitMapMerge({ ...base, ...written, ...(sources !== undefined ? { sources } : {}) }) ??
      parseKitMapMerge({ ...base, ...written }) ??
      parseKitMapMerge(base)
    if (!merge) {
      req.log.error({ id }, 'map merge row does not read as a merge')
      return reply.code(503).send({ error: 'merge_unavailable', message: "This merge can't be read right now." })
    }
    return reply.send(merge)
  })

  app.put<{ Params: { id: string }; Body: unknown }>(
    '/api/v1/map-merges/:id',
    { preHandler: requireClass('device'), bodyLimit: REPORT_BODY_LIMIT },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const principal = req.principal as Extract<Principal, { class: 'device' }>
      if (!principal.user_id) return reply.code(403).send({ error: 'user_token_required' })
      const userId = principal.user_id
      const id = req.params.id

      // Only the computer the merge change targets writes it.
      const changeRow = await db.kit_map_changes.findFirst({
        where: { id, user_id: userId, device_id: principal.device_id, kind: 'merge' },
        select: CHANGE_SELECT,
      })
      const change = changeRow ? mergeChangeOf(changeRow) : null
      if (!changeRow || !change) return reply.code(404).send(notFound)
      if (change.keys.length > KIT_MAP_MERGE_MAX_SOURCES) {
        return reply.code(422).send({
          error: 'too_many_sources',
          message: `A merge is written from at most ${KIT_MAP_MERGE_MAX_SOURCES} skills.`,
        })
      }
      const report: KitMapMergeReport | null = parseKitMapMergeReport(req.body, change.keys)
      if (!report) {
        return reply.code(422).send({
          error: 'invalid_merge_report',
          message:
            'A report is writing, ready (with merged, brief and one round per original), failed (with a reason) or out-of-date.',
        })
      }
      if (report.status === 'ready') {
        const backup = await db.skill_backups.findUnique({
          where: { user_id_hash: { user_id: userId, hash: report.merged } },
          select: { origin: true },
        })
        if (backup?.origin !== 'merge') {
          return reply.code(422).send({
            error: 'merged_not_backed_up',
            message: 'Back the merged skill up as a merge first, then report it ready.',
          })
        }
      }

      const now = Math.floor(Date.now() / 1000)
      const data: Prisma.map_mergesUncheckedUpdateManyInput = {
        device_id: principal.device_id,
        job: change.job,
        keys_json: JSON.stringify(change.keys),
        status: report.status,
        updated_at: now,
      }
      switch (report.status) {
        case 'ready':
          Object.assign(data, {
            reason: null,
            merged_hash: report.merged,
            brief: report.brief,
            rounds_json: JSON.stringify(report.rounds),
          })
          break
        case 'out-of-date':
          // What was written, if anything, stays on record beside why it can't be used.
          data.reason = report.reason ?? null
          break
        case 'failed':
          Object.assign(data, { reason: report.reason, merged_hash: null, brief: null, rounds_json: null })
          break
        case 'writing':
          Object.assign(data, { reason: null, merged_hash: null, brief: null, rounds_json: null })
          break
      }

      const locked = () =>
        reply.code(409).send({
          error: 'merge_picked',
          message: 'This merge was already picked, so the computer no longer reports on it.',
        })
      const update = () =>
        db.map_merges.updateMany({ where: { id, user_id: userId, status: { notIn: LOCKED } }, data })
      let won = await update()
      if (won.count === 0) {
        if (await db.map_merges.findUnique({ where: { id }, select: { id: true } })) return locked()
        try {
          await db.map_merges.create({
            data: {
              id,
              user_id: userId,
              created_at: changeRow.created_at,
              device_id: principal.device_id,
              job: change.job,
              keys_json: JSON.stringify(change.keys),
              status: report.status,
              reason: (data.reason as string | null | undefined) ?? null,
              merged_hash: (data.merged_hash as string | null | undefined) ?? null,
              brief: (data.brief as string | null | undefined) ?? null,
              rounds_json: (data.rounds_json as string | null | undefined) ?? null,
              updated_at: now,
            },
          })
        } catch (err) {
          // A second report at once made the row first: this one updates it.
          if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
          won = await update()
          if (won.count === 0) return locked()
        }
      }

      const row = await db.map_merges.findUnique({ where: { id }, select: ROW_SELECT })
      const merge = row ? parseKitMapMerge(listWire(row)) : null
      return reply.send({ merge })
    },
  )
}
