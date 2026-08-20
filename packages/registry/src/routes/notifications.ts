import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { requireSession } from '../auth/middleware.js'
import { pendingTargetsPrisma } from '../lib/pending-update-targets.js'
import {
  markNotificationsSeenPrisma,
  notificationEventRowsPrisma,
  notificationsSeenAtPrisma,
  unreadNotificationCountPrisma,
  viewerHandleForUserPrisma,
} from '../lib/notification-events.js'

/**
 * Notifications: the inverse of the feed. The feed reads events from people you
 * follow; notifications reads events about *you*: someone followed you, someone
 * subscribed to one of your public kits, or someone subscribed to your skills
 * (your author-kit). Built live from the same tables, filtered to the viewer as
 * the target, with self-events excluded. Unread is a single per-user "seen"
 * cursor (migration 018): events newer than it.
 */

export interface NotificationKit {
  kit_id: string
  name: string
  owner: string
  href: string
  skill_count: number
  description: string | null
  /** The public members' categories, in member order — the cover is a function of
   *  (seed, categories), so a card without them paints different art than the kit
   *  page for the same kit. */
  skill_categories?: (string | null)[]
}

export interface NotificationSkill {
  skill_id: string
  slug: string
  author: string
  category: string | null
  href: string
}

export type NotificationEvent =
  | { kind: 'followed_you'; actor: string; at: number; actor_avatar?: string | null }
  | {
      kind: 'subscribed_kit'
      actor: string
      at: number
      actor_avatar?: string | null
      kit: NotificationKit
    }
  | { kind: 'subscribed_author'; actor: string; at: number; actor_avatar?: string | null }
  | {
      kind: 'installed_skill'
      actor: string
      at: number
      actor_avatar?: string | null
      skill: NotificationSkill
    }
  // Someone submitted a pending change to a skill you own (directly, or as an
  // owner/admin of the team that owns it). Derived live from the pending
  // skill_proposals row, so it disappears once the proposal is decided. The
  // skill's href points at the review surface, not the public page.
  | {
      kind: 'proposal_received'
      actor: string
      at: number
      actor_avatar?: string | null
      skill: NotificationSkill
    }
  // System event (no actor): a published version of yours was blocked by the
  // harm scanner and pulled from installs (retroactive quarantine).
  | { kind: 'version_blocked'; at: number; reason: string; skill: NotificationSkill }
  // System event (no facepile): someone invited you to their team. Derived live
  // from the pending organization_invites row, so it disappears once the invite
  // is accepted, revoked, or expired. Carries the accept target (org slug +
  // invite id) so the web row can link straight to the accept page.
  | {
      kind: 'org_invited'
      at: number
      invite_id: string
      role: string
      org: { slug: string; name: string }
      inviter: string
    }

function sessionUserId(req: { principal?: unknown }): string | null {
  const p = req.principal as { class?: string; user_id?: string } | undefined
  return p && p.class === 'session' ? (p.user_id ?? null) : null
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

/** Explicit prisma arg wins; else use the app decorator when auth flipped to MySQL. */
function prismaForRoute(app: FastifyInstance, explicit?: PrismaClient): PrismaClient | undefined {
  if (explicit) return explicit
  if (app.skilletPrismaAuth && app.skilletPrisma) return app.skilletPrisma
  return undefined
}

export function registerNotificationRoutes(
  app: FastifyInstance,
  prisma?: PrismaClient,
): void {
  // GET /me/notifications - inbound events + the current unread count.
  app.get<{ Querystring: { limit?: string } }>(
    '/me/notifications',
    { preHandler: requireSession },
    async (req, reply) => {
      const db = requirePrisma(prismaForRoute(app, prisma))
      const userId = sessionUserId(req)
      if (!userId) return reply.status(401).send({ error: 'unauthorized' })
      try {
        const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100)
        const handle = await viewerHandleForUserPrisma(db, userId)
        if (!handle) return reply.send({ events: [], unread_count: 0 })
        const events = await notificationEventRowsPrisma(db, handle, userId, limit)
        const unread = await unreadNotificationCountPrisma(
          db,
          handle,
          userId,
          await notificationsSeenAtPrisma(db, userId),
        )
        return reply.send({ events, unread_count: unread })
      } catch (err) {
        req.log.error({ err }, 'notifications list query failed')
        return reply.send({ events: [], unread_count: 0 })
      }
    },
  )

  // GET /me/notifications/unread-count - just the count, for the nav bell.
  app.get('/me/notifications/unread-count', { preHandler: requireSession }, async (req, reply) => {
    const db = requirePrisma(prismaForRoute(app, prisma))
    const userId = sessionUserId(req)
    if (!userId) return reply.status(401).send({ error: 'unauthorized' })
    try {
      const pending = (await pendingTargetsPrisma(db, userId)).length
      const handle = await viewerHandleForUserPrisma(db, userId)
      if (!handle) return reply.send({ unread_count: 0, pending_updates_count: pending })
      return reply.send({
        unread_count: await unreadNotificationCountPrisma(
          db,
          handle,
          userId,
          await notificationsSeenAtPrisma(db, userId),
        ),
        pending_updates_count: pending,
      })
    } catch (err) {
      req.log.error({ err }, 'notifications unread-count query failed')
      return reply.send({ unread_count: 0, pending_updates_count: 0 })
    }
  })

  // POST /me/notifications/seen - advance the seen cursor to now, clearing unread.
  app.post('/me/notifications/seen', { preHandler: requireSession }, async (req, reply) => {
    const db = requirePrisma(prismaForRoute(app, prisma))
    const userId = sessionUserId(req)
    if (!userId) return reply.status(401).send({ error: 'unauthorized' })
    await markNotificationsSeenPrisma(db, userId)
    return reply.send({ unread_count: 0 })
  })
}
