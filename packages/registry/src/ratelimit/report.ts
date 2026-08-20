// Per-account abuse-report rate limiter.
import type { PrismaClient } from '@prisma/client'
import type { FastifyRequest, FastifyReply } from 'fastify'

export interface ReportLimitConfig {
  perHour: number
  perDay: number
}

const DEFAULTS: ReportLimitConfig = {
  perHour: 10,
  perDay: 40,
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

/** Resolve config from env at call time so tests can flip knobs. */
export function loadReportLimitConfig(): ReportLimitConfig {
  return {
    perHour: readPositiveInt('SKILLET_REPORT_RATE_PER_HOUR', DEFAULTS.perHour),
    perDay: readPositiveInt('SKILLET_REPORT_RATE_PER_DAY', DEFAULTS.perDay),
  }
}

async function countSincePrisma(
  prisma: PrismaClient,
  userId: string,
  sinceEpoch: number,
): Promise<number> {
  return prisma.skill_reports.count({
    where: { reported_by: userId, created_at: { gte: sinceEpoch } },
  })
}

async function oldestSincePrisma(
  prisma: PrismaClient,
  userId: string,
  sinceEpoch: number,
): Promise<number | null> {
  const row = await prisma.skill_reports.findFirst({
    where: { reported_by: userId, created_at: { gte: sinceEpoch } },
    orderBy: { created_at: 'asc' },
    select: { created_at: true },
  })
  return row?.created_at ?? null
}

function retryAfter(oldestEpoch: number, nowEpoch: number, windowSec: number): number {
  const wait = oldestEpoch + windowSec - nowEpoch
  return wait < 1 ? 1 : wait
}

/**
 * Fastify preHandler. Must run AFTER `requireSession`.
 * Prisma is required; sqlite fallthrough was removed in U2.
 */
export function requireReportRateLimit(_db: unknown, prisma?: PrismaClient) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!prisma) {
      throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
    }
    if (!req.principal || req.principal.class !== 'session') {
      await reply.code(401).send({ error: 'auth_required' })
      return
    }
    const userId = req.principal.user_id
    const cfg = loadReportLimitConfig()
    const now = Math.floor(Date.now() / 1000)

    const hourWindow = 3600
    const dayWindow = 86400

    const hourCount = await countSincePrisma(prisma, userId, now - hourWindow)
    if (hourCount >= cfg.perHour) {
      const oldest = await oldestSincePrisma(prisma, userId, now - hourWindow)
      const wait = oldest != null ? retryAfter(oldest, now, hourWindow) : hourWindow
      reply.header('Retry-After', String(wait))
      await reply.code(429).send({
        error: 'rate_limited',
        scope: 'hour',
        limit: cfg.perHour,
        retry_after_seconds: wait,
      })
      return
    }

    const dayCount = await countSincePrisma(prisma, userId, now - dayWindow)
    if (dayCount >= cfg.perDay) {
      const oldest = await oldestSincePrisma(prisma, userId, now - dayWindow)
      const wait = oldest != null ? retryAfter(oldest, now, dayWindow) : dayWindow
      reply.header('Retry-After', String(wait))
      await reply.code(429).send({
        error: 'rate_limited',
        scope: 'day',
        limit: cfg.perDay,
        retry_after_seconds: wait,
      })
    }
  }
}
