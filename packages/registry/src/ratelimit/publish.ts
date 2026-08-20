// PROTOCOL §7.4 — per-account publish-velocity limiter + burst alerter.
import type { FastifyRequest, FastifyReply } from 'fastify'
import { randomUUID } from 'node:crypto'
import type { PrismaDb } from '../db/prisma-client.js'

export interface PublishLimitConfig {
  perHour: number
  perDay: number
  burstWindowSeconds: number
  burstThreshold: number
}

// Caps guard the PUBLIC catalog against sustained spam. They must clear a
// legitimate bulk action: importing a plugin publishes one skill per file, so a
// large kit (e.g. everyinc/compound-engineering — 33 skills) fires 33 publishes
// in one user action. The old perHour:30 turned that into a silent partial
// import (30 published, 3 → 429 rate_limited, dropped by the wizard). Raised so a
// real import never trips the cap; perHour must stay ≤ perDay to stay coherent.
const DEFAULTS: PublishLimitConfig = {
  perHour: 250,
  perDay: 1000,
  burstWindowSeconds: 60,
  burstThreshold: 8,
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

/** Resolve the limiter config from env at call time (so tests can flip knobs). */
export function loadPublishLimitConfig(): PublishLimitConfig {
  return {
    perHour: readPositiveInt('SKILLET_PUBLISH_RATE_PER_HOUR', DEFAULTS.perHour),
    perDay: readPositiveInt('SKILLET_PUBLISH_RATE_PER_DAY', DEFAULTS.perDay),
    burstWindowSeconds: readPositiveInt(
      'SKILLET_PUBLISH_BURST_WINDOW_SECONDS',
      DEFAULTS.burstWindowSeconds,
    ),
    burstThreshold: readPositiveInt(
      'SKILLET_PUBLISH_BURST_THRESHOLD',
      DEFAULTS.burstThreshold,
    ),
  }
}

async function countSincePrisma(
  prisma: PrismaDb,
  userId: string,
  sinceEpoch: number,
): Promise<number> {
  return prisma.publish_log.count({
    where: { user_id: userId, published_at: { gte: sinceEpoch } },
  })
}

async function oldestSincePrisma(
  prisma: PrismaDb,
  userId: string,
  sinceEpoch: number,
): Promise<number | null> {
  const row = await prisma.publish_log.findFirst({
    where: { user_id: userId, published_at: { gte: sinceEpoch } },
    orderBy: { published_at: 'asc' },
    select: { published_at: true },
  })
  return row?.published_at ?? null
}

function retryAfter(oldestEpoch: number, nowEpoch: number, windowSec: number): number {
  const wait = oldestEpoch + windowSec - nowEpoch
  return wait < 1 ? 1 : wait
}

/**
 * Fastify preHandler. Prisma is required; sqlite fallthrough was removed in U2.
 */
export function requirePublishRateLimit(_db: unknown, prisma?: PrismaDb) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!prisma) {
      throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
    }
    if (!req.principal || req.principal.class !== 'session') {
      await reply.code(401).send({ error: 'auth_required' })
      return
    }
    const userId = req.principal.user_id
    const cfg = loadPublishLimitConfig()
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

/**
 * Fail-closed stand-in for residual dual-path publish callers outside U2.
 */
export function recordPublishAndMaybeAlert(
  _db: unknown,
  _args: {
    userId: string
    skillId: string
    contentHash: string
    publishedAt: number
  },
): { logId: string; alertRaised: boolean } {
  throw new Error('sqlite registry store removed; use recordPublishAndMaybeAlertPrisma')
}

/** Prisma path for publish_log + burst alert. */
export async function recordPublishAndMaybeAlertPrisma(
  prisma: PrismaDb,
  args: {
    userId: string
    skillId: string
    contentHash: string
    publishedAt: number
  },
): Promise<{ logId: string; alertRaised: boolean }> {
  const cfg = loadPublishLimitConfig()
  const logId = randomUUID()
  await prisma.publish_log.create({
    data: {
      id: logId,
      user_id: args.userId,
      skill_id: args.skillId,
      content_hash: args.contentHash,
      published_at: args.publishedAt,
    },
  })

  const burstSince = args.publishedAt - cfg.burstWindowSeconds
  const burstCount = await countSincePrisma(prisma, args.userId, burstSince)

  let alertRaised = false
  if (burstCount > cfg.burstThreshold) {
    const payload = {
      event: 'publish_burst',
      user_id: args.userId,
      count: burstCount,
      window_seconds: cfg.burstWindowSeconds,
      threshold: cfg.burstThreshold,
      raised_at: args.publishedAt,
    }
    process.stdout.write(JSON.stringify(payload) + '\n')

    await prisma.alerts.create({
      data: {
        id: randomUUID(),
        kind: 'publish_burst',
        user_id: args.userId,
        payload_json: JSON.stringify(payload),
        raised_at: args.publishedAt,
      },
    })
    alertRaised = true
  }

  return { logId, alertRaised }
}
