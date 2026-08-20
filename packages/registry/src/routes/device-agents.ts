import type { FastifyInstance } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { Principal } from '../auth/middleware.js'
import { canActOnDevice, requireUser } from '../auth/middleware.js'
import {
  parseEditedSkills,
  reconcileDeviceSkillEditsPrisma,
} from './device-skill-edits.js'

const AGENT_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/
const MAX_AGENTS = 24

const MATERIALIZATION_STATUSES = new Set(['materialized', 'skipped-not-detected', 'failed'])
export const MAX_MATERIALIZATIONS = 256

export interface MaterializationInput {
  skill_slug: string
  runtime: string
  status: string
}

/**
 * Validate the device→registry per-skill/per-runtime status payload.
 *
 * Oversized reports CLAMP to the cap instead of rejecting: a big kit (200
 * skills × 6 runtimes) legitimately exceeds any fixed cap, and a 400 here
 * used to take the whole request down — including the `edited` reconcile
 * riding it, which silently wedged the approve flow for every large-kit
 * device (the fire-and-forget client swallows the failure). The matrix is
 * best-effort telemetry; the edit flags are consent-critical. Malformed
 * items still reject: they can only come from a broken client.
 */
export function parseMaterializations(raw: unknown): MaterializationInput[] | null {
  if (!Array.isArray(raw)) return null
  const capped = raw.length > MAX_MATERIALIZATIONS ? raw.slice(0, MAX_MATERIALIZATIONS) : raw
  const out: MaterializationInput[] = []
  for (const item of capped) {
    if (!item || typeof item !== 'object') return null
    const { skill_slug, runtime, status } = item as Record<string, unknown>
    if (typeof skill_slug !== 'string' || skill_slug.length === 0 || skill_slug.length > 200) return null
    if (typeof runtime !== 'string') return null
    const runtimeKey = runtime.trim().toLowerCase()
    if (!AGENT_NAME_RE.test(runtimeKey)) return null
    if (typeof status !== 'string' || !MATERIALIZATION_STATUSES.has(status)) return null
    out.push({ skill_slug, runtime: runtimeKey, status })
  }
  return out
}

interface DeviceRow {
  id: string
  user_id: string | null
}

export function parseAgentList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== 'string') return null
    const name = item.trim().toLowerCase()
    if (!AGENT_NAME_RE.test(name)) return null
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
    if (out.length > MAX_AGENTS) return null
  }
  out.sort()
  return out
}

export function parseStoredAgents(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    const list = parseAgentList(parsed)
    return list ?? []
  } catch {
    return []
  }
}

function canUpdateDevice(principal: Principal, row: DeviceRow, deviceId: string): boolean {
  if (row.id !== deviceId) return false
  return canActOnDevice(principal, row, deviceId)
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerDeviceAgentRoutes(
  app: FastifyInstance,
  _db: DatabaseSync,
  prismaArg?: PrismaClient,
): void {
  const prisma = requirePrisma(
    prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
  )

  app.put<{ Params: { device_id: string }; Body: { agents?: unknown } }>(
    '/api/v1/devices/:device_id/agents',
    { preHandler: requireUser() },
    async (req, reply) => {
      const principal = req.principal as Principal
      const { device_id } = req.params
      const agents = parseAgentList(req.body?.agents)
      if (!agents) {
        return reply.code(400).send({ error: 'invalid_agents' })
      }

      const row = await prisma.devices.findUnique({
        where: { id: device_id },
        select: { id: true, user_id: true },
      })
      if (!row || !canUpdateDevice(principal, row, device_id)) {
        return reply.code(404).send({ error: 'device_not_found' })
      }
      const now = Math.floor(Date.now() / 1000)
      await prisma.devices.update({
        where: { id: device_id },
        data: {
          detected_agents: JSON.stringify(agents),
          agents_reported_at: now,
          last_seen_at: now,
        },
      })
      return reply.send({ device_id, agents, reported_at: now })
    },
  )

  app.put<{ Params: { device_id: string }; Body: { materializations?: unknown; edited?: unknown } }>(
    '/api/v1/devices/:device_id/materializations',
    { preHandler: requireUser() },
    async (req, reply) => {
      const principal = req.principal as Principal
      const { device_id } = req.params
      const rows = parseMaterializations(req.body?.materializations)
      if (!rows) {
        return reply.code(400).send({ error: 'invalid_materializations' })
      }
      // No silent caps: tell the client how many rows the clamp dropped.
      const sent = Array.isArray(req.body?.materializations)
        ? (req.body!.materializations as unknown[]).length
        : rows.length
      const dropped = Math.max(0, sent - rows.length)
      const hasEdited =
        req.body != null && typeof req.body === 'object' && 'edited' in (req.body as object)
      const edited = parseEditedSkills(req.body?.edited)
      if (!edited) {
        return reply.code(400).send({ error: 'invalid_edited' })
      }

      const device = await prisma.devices.findUnique({
        where: { id: device_id },
        select: { id: true, user_id: true },
      })
      if (!device || !canUpdateDevice(principal, device, device_id) || device.user_id == null) {
        return reply.code(404).send({ error: 'device_not_found' })
      }
      const now = Math.floor(Date.now() / 1000)
      for (const r of rows) {
        await prisma.device_skill_materializations.upsert({
          where: {
            device_id_skill_slug_runtime: {
              device_id,
              skill_slug: r.skill_slug,
              runtime: r.runtime,
            },
          },
          create: {
            device_id,
            skill_slug: r.skill_slug,
            runtime: r.runtime,
            status: r.status,
            reported_at: now,
          },
          update: { status: r.status, reported_at: now },
        })
      }
      if (hasEdited) {
        await reconcileDeviceSkillEditsPrisma(prisma, device_id, device.user_id, edited, now)
      }
      return reply.send({
        device_id,
        count: rows.length,
        ...(dropped > 0 ? { dropped } : {}),
        edited: hasEdited ? edited.length : 0,
        reported_at: now,
      })
    },
  )

  app.get<{ Params: { device_id: string }; Querystring: { skill?: string } }>(
    '/api/v1/devices/:device_id/materializations',
    { preHandler: requireUser() },
    async (req, reply) => {
      const principal = req.principal as Principal
      const { device_id } = req.params

      const device = await prisma.devices.findUnique({
        where: { id: device_id },
        select: { id: true, user_id: true },
      })
      if (!device || !canUpdateDevice(principal, device, device_id)) {
        return reply.code(404).send({ error: 'device_not_found' })
      }
      const skill = typeof req.query.skill === 'string' ? req.query.skill : null
      const rows = await prisma.device_skill_materializations.findMany({
        where: {
          device_id,
          ...(skill ? { skill_slug: skill } : {}),
        },
        orderBy: { reported_at: 'desc' },
        select: {
          skill_slug: true,
          runtime: true,
          status: true,
          reported_at: true,
        },
      })
      return reply.send({ device_id, materializations: rows })
    },
  )
}
