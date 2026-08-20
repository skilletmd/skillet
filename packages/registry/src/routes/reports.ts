// Abuse report intake. A signed-in user reports a skill; the report lands in the
// private `skill_reports` queue for admin triage. Requires a session (any
// authenticated user — NOT publish scope), a per-account rate limit, and a
// not-suspended account. The reporter is never echoed back to anyone.
import type { PrismaClient } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import type { DatabaseSync } from '../db/sqlite-handle.js'
import { randomUUID } from 'node:crypto'
import { requireSession } from '../auth/middleware.js'
import { requireReportRateLimit } from '../ratelimit/report.js'
import { isUserSuspendedPrisma, resolveSkillRefPrisma } from '../lib/ref-resolution.js'

/** The safety-focused category set plus the copyright/takedown fast path. */
export const REPORT_CATEGORIES = [
  'malware',
  'prompt_injection',
  'spam',
  'abusive',
  'copyright',
  'other',
] as const
type ReportCategory = (typeof REPORT_CATEGORIES)[number]

const MAX_REASON_LEN = 2000

interface ReportBody {
  category?: string
  reason?: string
  version_hash?: string
  claims_ownership?: boolean
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerReportRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  prismaArg?: PrismaClient,
): void {
  const prisma = requirePrisma(
    prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
  )

  app.post<{ Params: { author: string; slug: string }; Body: ReportBody }>(
    '/skills/:author/:slug/report',
    { preHandler: [requireSession, requireReportRateLimit(db, prisma)] },
    async (req, reply) => {
      const principal = req.principal as Extract<
        NonNullable<typeof req.principal>,
        { class: 'session' }
      >
      const userId = principal.user_id

      if (await isUserSuspendedPrisma(prisma, userId)) {
        return reply.status(403).send({ error: 'account_suspended' })
      }

      const { author, slug } = req.params
      const resolved = await resolveSkillRefPrisma(prisma, author, slug)
      if (!resolved) {
        return reply.status(404).send({ error: 'skill_not_found' })
      }

      const body = req.body ?? {}
      const category = body.category
      if (
        typeof category !== 'string' ||
        !REPORT_CATEGORIES.includes(category as ReportCategory)
      ) {
        return reply.status(400).send({ error: 'invalid_category' })
      }

      const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
      if (reason.length > MAX_REASON_LEN) {
        return reply.status(400).send({ error: 'reason_too_long' })
      }
      if (category === 'other' && reason.length === 0) {
        return reply.status(400).send({ error: 'reason_required' })
      }

      let claimsOwnership: number | null = null
      if (category === 'copyright') {
        if (body.claims_ownership !== true) {
          return reply.status(400).send({ error: 'ownership_required' })
        }
        claimsOwnership = 1
      }

      const versionHash =
        typeof body.version_hash === 'string' && body.version_hash ? body.version_hash : null

      const id = randomUUID()
      await prisma.skill_reports.create({
        data: {
          id,
          skill_id: resolved.skillId,
          version_hash: versionHash,
          reported_by: userId,
          category,
          reason: reason.length > 0 ? reason : null,
          claims_ownership: claimsOwnership,
          status: 'open',
        },
      })

      return reply.status(201).send({ id, status: 'open' })
    },
  )
}
