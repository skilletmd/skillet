// Per-IP brute-force limiter for POST /api/v1/connect/claim.
import type { FastifyRequest, FastifyReply } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { PrismaDb } from '../db/prisma-client.js'

export interface PairClaimLimitConfig {
  perMinute: number
  perHour: number
  globalPerMinute: number
}

const DEFAULTS: PairClaimLimitConfig = {
  perMinute: 10,
  perHour: 60,
  globalPerMinute: 300,
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

export function loadPairClaimLimitConfig(): PairClaimLimitConfig {
  return {
    perMinute: readPositiveInt('SKILLET_PAIR_CLAIM_RATE_PER_MINUTE', DEFAULTS.perMinute),
    perHour: readPositiveInt('SKILLET_PAIR_CLAIM_RATE_PER_HOUR', DEFAULTS.perHour),
    globalPerMinute: readPositiveInt(
      'SKILLET_PAIR_CLAIM_GLOBAL_PER_MINUTE',
      DEFAULTS.globalPerMinute,
    ),
  }
}

function retryAfter(oldestEpoch: number, nowEpoch: number, windowSec: number): number {
  const wait = oldestEpoch + windowSec - nowEpoch
  return wait < 1 ? 1 : wait
}

/**
 * Fastify preHandler. Prisma is required; sqlite fallthrough was removed in U2.
 */
export function requirePairClaimRateLimit(_db: unknown, prisma?: PrismaDb) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!prisma) {
      throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
    }
    const ip = req.ip || 'unknown'
    const cfg = loadPairClaimLimitConfig()
    const now = Math.floor(Date.now() / 1000)
    const minuteWindow = 60
    const hourWindow = 3600

    const minuteCount = await prisma.pair_claim_attempts.count({
      where: { ip, attempted_at: { gte: now - minuteWindow } },
    })
    const hourCount = await prisma.pair_claim_attempts.count({
      where: { ip, attempted_at: { gte: now - hourWindow } },
    })
    const globalCount = await prisma.pair_claim_attempts.count({
      where: { attempted_at: { gte: now - minuteWindow } },
    })

    await prisma.pair_claim_attempts.create({
      data: { id: randomUUID(), ip, attempted_at: now },
    })

    await prisma.pair_claim_attempts.deleteMany({
      where: { attempted_at: { lt: now - hourWindow } },
    })

    if (globalCount >= cfg.globalPerMinute) {
      req.log.warn(
        { globalCount, limit: cfg.globalPerMinute },
        'pair-claim global rate limit tripped; possible brute-force; investigate',
      )
      reply.header('Retry-After', '60')
      await reply.code(429).send({
        error: 'rate_limited',
        scope: 'global',
        limit: cfg.globalPerMinute,
        retry_after_seconds: 60,
      })
      return
    }

    if (minuteCount >= cfg.perMinute) {
      const oldest = await prisma.pair_claim_attempts.findFirst({
        where: { ip, attempted_at: { gte: now - minuteWindow } },
        orderBy: { attempted_at: 'asc' },
        select: { attempted_at: true },
      })
      const wait =
        oldest != null ? retryAfter(oldest.attempted_at, now, minuteWindow) : minuteWindow
      reply.header('Retry-After', String(wait))
      await reply.code(429).send({
        error: 'rate_limited',
        scope: 'minute',
        limit: cfg.perMinute,
        retry_after_seconds: wait,
      })
      return
    }

    if (hourCount >= cfg.perHour) {
      const oldest = await prisma.pair_claim_attempts.findFirst({
        where: { ip, attempted_at: { gte: now - hourWindow } },
        orderBy: { attempted_at: 'asc' },
        select: { attempted_at: true },
      })
      const wait =
        oldest != null ? retryAfter(oldest.attempted_at, now, hourWindow) : hourWindow
      reply.header('Retry-After', String(wait))
      await reply.code(429).send({
        error: 'rate_limited',
        scope: 'hour',
        limit: cfg.perHour,
        retry_after_seconds: wait,
      })
    }
  }
}
