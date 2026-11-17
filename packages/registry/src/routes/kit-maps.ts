// The saved kit map and the changes waiting for a computer (kit map onboarding,
// KTD9).
//
//   GET  /api/v1/kit-map                    the caller's saved map
//   PUT  /api/v1/kit-map                    write it, sending the version read
//   GET  /api/v1/kit-map/changes            changes still to apply
//   POST /api/v1/kit-map/changes            record changes (remove, merge, replace)
//   POST /api/v1/kit-map/changes/claim      a computer claims device-less changes its scan holds
//   POST /api/v1/kit-map/changes/:id/ack    a computer acknowledges one change, once
//
// Both shapes come from `@skillet/protocol/kit-map`, and what goes out is
// exactly what its parsers read back: a saved map holds entries and job
// assignments, never a path, a usage mark or its reason; a change holds content
// hashes only, and a computer finds its folders through a fresh local scan.
// Every change write wakes the account's connected apps through
// bumpUserDeviceSyncPrisma, so a change picked on skillet.md lands in seconds.

import type { FastifyInstance } from 'fastify'
import { Prisma, type PrismaClient } from '@prisma/client'
import {
  KIT_MAP_CODE_RE,
  KIT_MAP_HASH_RE,
  KIT_MAP_VERSION,
  parseKitMapDocument,
  parseKitMapPendingChange,
  type KitMapPendingChange,
} from '@skillet/protocol/kit-map'
import { requireClass, requireUser, type Principal } from '../auth/middleware.js'
import { newId } from '../db/index.js'
import { runPrismaTransaction } from '../db/prisma-client.js'
import { bumpUserDeviceSyncPrisma } from '../lib/device-sync-stream.js'

/** A whole map of 10,000 entries with full descriptions fits. */
const MAP_BODY_LIMIT = 16 * 1024 * 1024
const MAX_CHANGES_PER_WRITE = 10_000
/** Open (unacknowledged) changes one account may hold. */
const MAX_OPEN_CHANGES = 20_000
const MAX_CLAIM_KEYS = 10_000
/** `kit_map_changes.version` is a signed INT. */
const MAX_CHANGE_VERSION = 2_147_483_647

type StoredKind = 'remove' | 'merge' | 'replace'

interface ChangeRow {
  id: string
  device_id: string | null
  kind: string
  version: number
  body_json: string
}

const CHANGE_SELECT = { id: true, device_id: true, kind: true, version: true, body_json: true } as const

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  return prisma
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function userIdOf(principal: Principal): string {
  return (principal as { user_id: string }).user_id
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown
    return isRecord(value) ? value : {}
  } catch {
    return {}
  }
}

/** A change on the wire: exactly the protocol's record, so its parser reads it back. */
function toWire(row: ChangeRow): Record<string, unknown> {
  return { id: row.id, kind: row.kind, device: row.device_id, version: row.version, ...parseObject(row.body_json) }
}

/** The kind's own fields, as stored apart from the record. */
function bodyOf(change: Exclude<KitMapPendingChange, { kind: 'unknown' }>): Record<string, unknown> {
  switch (change.kind) {
    case 'remove':
      return { key: change.key }
    case 'merge':
      return { job: change.job, keys: change.keys }
    case 'replace':
      return { merged: change.merged, keys: change.keys }
  }
}

/** The hashes a computer's scan must hold to claim a device-less change. */
function heldKeys(row: ChangeRow): string[] {
  const body = parseObject(row.body_json)
  if (row.kind === 'remove') return typeof body.key === 'string' ? [body.key] : []
  return Array.isArray(body.keys) ? body.keys.filter((key): key is string => typeof key === 'string') : []
}

export function registerKitMapRoutes(app: FastifyInstance, prismaArg?: PrismaClient): void {
  const prisma =
    prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined)

  app.get('/api/v1/kit-map', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma)
    const row = await db.kit_maps.findUnique({
      where: { user_id: userIdOf(req.principal!) },
      select: { version: true, document_json: true },
    })
    if (!row) {
      return reply.code(404).send({ error: 'kit_map_not_found', message: 'No saved map on this account yet.' })
    }
    const doc = parseObject(row.document_json)
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ version: row.version, entries: doc.entries ?? [], assignments: doc.assignments ?? {} })
  })

  app.put<{ Body: unknown }>(
    '/api/v1/kit-map',
    { preHandler: requireUser(), bodyLimit: MAP_BODY_LIMIT },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const userId = userIdOf(req.principal!)
      // Its entries hold no field but key, name, description, source, from and
      // skillet, so a path or a usage mark anywhere rejects the whole map.
      const doc = parseKitMapDocument(req.body)
      if (!doc) {
        return reply.code(422).send({
          error: 'invalid_kit_map',
          message: 'The map is malformed, or holds something a saved map never keeps, such as a path or usage.',
        })
      }
      const conflict = async () => {
        const current = await db.kit_maps.findUnique({ where: { user_id: userId }, select: { version: true } })
        return reply.code(409).send({
          error: 'version_conflict',
          message: 'The saved map changed since it was read. Read it again.',
          version: current?.version ?? 0,
        })
      }
      const now = Math.floor(Date.now() / 1000)
      const documentJson = JSON.stringify({ entries: doc.entries, assignments: doc.assignments })
      const next = doc.version + 1
      if (doc.version === 0) {
        try {
          await db.kit_maps.create({
            data: { user_id: userId, version: next, document_json: documentJson, updated_at: now },
          })
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return conflict()
          throw err
        }
      } else {
        const won = await db.kit_maps.updateMany({
          where: { user_id: userId, version: doc.version },
          data: { version: next, document_json: documentJson, updated_at: now },
        })
        if (won.count === 0) return conflict()
      }
      return reply.send({ version: next })
    },
  )

  app.get('/api/v1/kit-map/changes', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma)
    const principal = req.principal!
    const rows = await db.kit_map_changes.findMany({
      where: {
        user_id: userIdOf(principal),
        acknowledged_at: null,
        // A computer sees its own; the web sees every change on the account.
        ...(principal.class === 'device' ? { device_id: principal.device_id } : {}),
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: CHANGE_SELECT,
    })
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ changes: rows.map(toWire) })
  })

  app.post<{ Body: { changes?: unknown } }>(
    '/api/v1/kit-map/changes',
    { preHandler: requireUser(), bodyLimit: MAP_BODY_LIMIT },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const principal = req.principal!
      const userId = userIdOf(principal)
      const input = req.body?.changes
      if (!Array.isArray(input) || input.length === 0 || input.length > MAX_CHANGES_PER_WRITE) {
        return reply.code(422).send({
          error: 'invalid_change',
          message: `changes is a list of 1 to ${MAX_CHANGES_PER_WRITE} changes`,
        })
      }

      // A computer records changes for itself (KTD10). The web may target a
      // computer on this account, or none after a dropped-folder Save.
      const ownDevices = new Set<string>()
      if (principal.class === 'session') {
        const targets = [
          ...new Set(
            input
              .map((item) => (isRecord(item) ? item.device : undefined))
              .filter((device): device is string => typeof device === 'string'),
          ),
        ]
        if (targets.length > 0) {
          const rows = await db.devices.findMany({
            where: { id: { in: targets }, user_id: userId, revoked_at: null },
            select: { id: true },
          })
          for (const row of rows) ownDevices.add(row.id)
        }
      }

      const now = Math.floor(Date.now() / 1000)
      const records: Prisma.kit_map_changesCreateManyInput[] = []
      for (const [index, item] of input.entries()) {
        const refuse = (message: string) =>
          reply.code(422).send({ error: 'invalid_change', message: `change ${index}: ${message}`, index })
        if (!isRecord(item)) return refuse('not an object')
        if ('id' in item) return refuse('the registry names changes')
        let device: string | null
        if (principal.class === 'device') {
          if (item.device !== undefined && item.device !== principal.device_id) {
            return refuse('a computer records changes for itself only')
          }
          device = principal.device_id
        } else if (item.device === undefined || item.device === null) {
          device = null
        } else if (typeof item.device === 'string' && ownDevices.has(item.device)) {
          device = item.device
        } else {
          return refuse('device is not a computer on this account')
        }
        const version = item.version ?? KIT_MAP_VERSION
        const parsed = parseKitMapPendingChange({ ...item, id: 'pending', device, version })
        if (!parsed || parsed.kind === 'unknown') return refuse('not a remove, merge or replace this registry can read')
        if (parsed.version > MAX_CHANGE_VERSION) return refuse('version is out of range')
        records.push({
          id: newId(),
          user_id: userId,
          device_id: device,
          kind: parsed.kind as StoredKind,
          version: parsed.version,
          body_json: JSON.stringify(bodyOf(parsed)),
          created_at: now,
        })
      }

      const open = await db.kit_map_changes.count({ where: { user_id: userId, acknowledged_at: null } })
      if (open + records.length > MAX_OPEN_CHANGES) {
        return reply.code(409).send({
          error: 'too_many_changes',
          message: `An account holds at most ${MAX_OPEN_CHANGES} changes waiting for a computer.`,
        })
      }
      await db.kit_map_changes.createMany({ data: records })
      await bumpUserDeviceSyncPrisma(db, userId)
      return reply.code(201).send({
        changes: records.map((record) =>
          toWire({
            id: record.id,
            device_id: record.device_id ?? null,
            kind: record.kind,
            version: record.version,
            body_json: record.body_json,
          }),
        ),
      })
    },
  )

  // KTD9: a change from a dropped-folder Save has no computer yet. The first
  // computer that connected after it was made, and whose fresh scan holds every
  // hash it names, takes it in one transaction. A computer connected earlier
  // never does: it wasn't the one the person dropped.
  app.post<{ Body: { keys?: unknown } }>(
    '/api/v1/kit-map/changes/claim',
    { preHandler: requireClass('device'), bodyLimit: MAP_BODY_LIMIT },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const principal = req.principal as Extract<Principal, { class: 'device' }>
      if (!principal.user_id) return reply.code(403).send({ error: 'user_token_required' })
      const userId = principal.user_id
      const keys = req.body?.keys
      if (
        !Array.isArray(keys) ||
        keys.length > MAX_CLAIM_KEYS ||
        !keys.every((key) => typeof key === 'string' && KIT_MAP_HASH_RE.test(key))
      ) {
        return reply.code(422).send({
          error: 'invalid_keys',
          message: `keys is the scan's content hashes, at most ${MAX_CLAIM_KEYS}`,
        })
      }
      const device = await db.devices.findUnique({
        where: { id: principal.device_id },
        select: { connected_at: true, created_at: true },
      })
      if (!device) return reply.code(403).send({ error: 'user_token_required' })
      const connectedAt = device.connected_at ?? device.created_at
      const held = new Set(keys as string[])
      const now = Math.floor(Date.now() / 1000)

      const claimed = await runPrismaTransaction(db, async (tx) => {
        const waiting = await tx.kit_map_changes.findMany({
          where: { user_id: userId, device_id: null, acknowledged_at: null, created_at: { lte: connectedAt } },
          orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
          select: CHANGE_SELECT,
        })
        const won: ChangeRow[] = []
        for (const row of waiting) {
          const needs = heldKeys(row)
          if (needs.length === 0 || !needs.every((key) => held.has(key))) continue
          const taken = await tx.kit_map_changes.updateMany({
            where: { id: row.id, device_id: null, acknowledged_at: null },
            data: { device_id: principal.device_id, claimed_at: now },
          })
          if (taken.count === 1) won.push({ ...row, device_id: principal.device_id })
        }
        return won
      })
      if (claimed.length > 0) await bumpUserDeviceSyncPrisma(db, userId)
      return reply.send({ claimed: claimed.map(toWire) })
    },
  )

  app.post<{ Params: { id: string }; Body: { outcome?: unknown } }>(
    '/api/v1/kit-map/changes/:id/ack',
    { preHandler: requireClass('device'), bodyLimit: 16 * 1024 },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const principal = req.principal as Extract<Principal, { class: 'device' }>
      if (!principal.user_id) return reply.code(403).send({ error: 'user_token_required' })
      const userId = principal.user_id
      const outcome = req.body?.outcome
      if (outcome !== undefined && (typeof outcome !== 'string' || !KIT_MAP_CODE_RE.test(outcome))) {
        return reply.code(422).send({ error: 'invalid_outcome', message: 'outcome is a short code, such as applied' })
      }
      const mine = { id: req.params.id, user_id: userId, device_id: principal.device_id }
      const won = await db.kit_map_changes.updateMany({
        where: { ...mine, acknowledged_at: null },
        data: { acknowledged_at: Math.floor(Date.now() / 1000), outcome: (outcome as string | undefined) ?? null },
      })
      if (won.count === 0) {
        const row = await db.kit_map_changes.findFirst({ where: mine, select: { acknowledged_at: true } })
        if (!row) return reply.code(404).send({ error: 'change_not_found', message: 'No such change for this computer.' })
        return reply.code(409).send({ error: 'already_acknowledged', message: 'This change was already acknowledged.' })
      }
      await bumpUserDeviceSyncPrisma(db, userId)
      return reply.send({ ok: true })
    },
  )
}
