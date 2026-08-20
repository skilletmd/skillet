// U3 — account-level update mode (auto | manual). The single account control for
// how subscribed updates arrive; maps to the external global trust default on the
// client (auto -> auto, manual -> gate). Per-author/kit/skill overrides remain
// above it in the client's precedence.
import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { requireUser, type Principal } from '../auth/middleware.js'
import {
  getAccountUpdateModePrisma,
  patchAccountUpdateModePrisma,
} from '../lib/account-update-mode.js'

/** Narrow a requireUser-gated principal to its user id (session or user-bound device). */
export function accountUserId(p: Principal): string {
  if (p.class === 'session') return p.user_id
  if (p.class === 'device') return p.user_id ?? ''
  return ''
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerAccountRoutes(
  app: FastifyInstance,
  prisma?: PrismaClient,
): void {
  app.get('/me/update-mode', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma)
    const userId = accountUserId(req.principal as Principal)
    const mode = await getAccountUpdateModePrisma(db, userId)
    return reply.send({ mode })
  })

  app.patch<{ Body: { mode?: string } }>(
    '/me/update-mode',
    { preHandler: requireUser() },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const userId = accountUserId(req.principal as Principal)
      const mode = req.body?.mode
      if (mode !== 'auto' && mode !== 'manual') {
        return reply.status(400).send({ error: 'mode must be "auto" or "manual"' })
      }
      // Flipping to auto stamps everything currently pending as approved/source:auto
      // so it applies immediately (even before a sync). The web confirms this with
      // the user first ("this will apply N pending updates now"), so report the count.
      // The mode write and the stamp are one transaction: a failure mid-stamp must
      // not leave the account flipped to auto with only part of the queue approved.
      const applied = await patchAccountUpdateModePrisma(db, userId, mode)
      return reply.send({ mode, applied })
    },
  )

  // The team kits the caller has muted (opted out of auto-sync). The web renders
  // the per-kit toggle state from this.
  app.get('/me/muted-team-kits', { preHandler: requireUser() }, async (req, reply) => {
    const db = requirePrisma(prisma)
    const userId = accountUserId(req.principal as Principal)
    const rows = await db.muted_team_kits.findMany({
      where: { user_id: userId },
      select: { kit_id: true },
    })
    return reply.send({ kit_ids: rows.map((r) => r.kit_id) })
  })

  // Mute a team kit: stop syncing it (drops from manifest, pending queue, and the
  // approvals guard together). Only a kit owned by a team the caller is an
  // accepted member of can be muted.
  app.put<{ Params: { kitId: string } }>(
    '/me/team-kits/:kitId/mute',
    { preHandler: requireUser() },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const userId = accountUserId(req.principal as Principal)
      const kitId = req.params.kitId
      const kit = await db.kits.findUnique({ where: { id: kitId }, select: { owner_id: true } })
      if (!kit) return reply.status(404).send({ error: 'kit_not_found' })
      const org = await db.organizations.findUnique({
        where: { slug: kit.owner_id },
        select: { id: true },
      })
      if (!org) return reply.status(400).send({ error: 'not_a_team_kit' })
      const member = await db.organization_members.findFirst({
        where: { org_id: org.id, user_id: userId, accepted_at: { not: null } },
        select: { user_id: true },
      })
      if (!member) return reply.status(403).send({ error: 'not_a_member' })
      await db.muted_team_kits.createMany({
        data: [{ user_id: userId, kit_id: kitId }],
        skipDuplicates: true,
      })
      return reply.send({ muted: true })
    },
  )

  // Unmute a team kit — idempotent (deleting a non-existent mute is a no-op).
  app.delete<{ Params: { kitId: string } }>(
    '/me/team-kits/:kitId/mute',
    { preHandler: requireUser() },
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const userId = accountUserId(req.principal as Principal)
      await db.muted_team_kits.deleteMany({
        where: { user_id: userId, kit_id: req.params.kitId },
      })
      return reply.send({ muted: false })
    },
  )
}
