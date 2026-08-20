// Public moderation log. Renders CURRENTLY-ACTIVE enforcement only — a skill
// appears while its `moderation_status` is quarantined/unlisted and drops off
// the moment an admin reverses it (decision O4). Derived from
// `skills.moderation_status` joined to the latest matching public action, so a
// reversal needs no separate "un-publish" write.
//
// Public + unauthenticated: it only exposes the skill ref, the enforcement
// state, and the admin-authored `public_reason`. It never exposes reporters,
// report text, or dismissed reports.
import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import {
  countActiveModerationPrisma,
  listActiveModerationPrisma,
} from '../lib/moderation-log.js'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

function clampInt(raw: unknown, fallback: number, min: number, max: number): number {
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerModerationRoutes(
  app: FastifyInstance,
  prisma?: PrismaClient,
): void {
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    '/moderation',
    async (req, reply) => {
      const db = requirePrisma(prisma)
      const limit = clampInt(req.query.limit, DEFAULT_LIMIT, 1, MAX_LIMIT)
      const offset = clampInt(req.query.offset, 0, 0, 100_000)

      const [total, entries] = await Promise.all([
        countActiveModerationPrisma(db),
        listActiveModerationPrisma(db, { limit, offset }),
      ])
      return reply.send({ entries, total, limit, offset })
    },
  )
}
