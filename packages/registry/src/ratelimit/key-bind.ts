// per-user bind-attempt rate limiter for POST /api/v1/auth/keys.
import type { FastifyRequest, FastifyReply } from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { randomUUID } from 'node:crypto'

export interface KeyBindLimitConfig {
  perHour: number
}

const DEFAULTS: KeyBindLimitConfig = {
  perHour: 20,
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

export function loadKeyBindLimitConfig(): KeyBindLimitConfig {
  return {
    perHour: readPositiveInt('SKILLET_KEY_BIND_RATE_PER_HOUR', DEFAULTS.perHour),
  }
}

function retryAfter(oldestEpoch: number, nowEpoch: number, windowSec: number): number {
  const wait = oldestEpoch + windowSec - nowEpoch
  return wait < 1 ? 1 : wait
}

const HOUR_WINDOW_SEC = 3600
const PRUNE_BUFFER_SEC = 86_400

/**
 * Fastify preHandler. Prisma is required; sqlite fallthrough was removed in U2.
 */
export function requireKeyBindRateLimit(_db: unknown, prisma?: PrismaClient) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!prisma) {
      throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
    }
    if (!req.principal || req.principal.class !== 'session') {
      await reply.code(401).send({ error: 'auth_required' })
      return
    }
    const userId = req.principal.user_id
    const cfg = loadKeyBindLimitConfig()
    const now = Math.floor(Date.now() / 1000)
    const hourWindow = HOUR_WINDOW_SEC

    const cutoff = now - HOUR_WINDOW_SEC - PRUNE_BUFFER_SEC
    await prisma.key_bind_attempts.deleteMany({
      where: { attempted_at: { lt: cutoff } },
    })
    const hourCount = await prisma.key_bind_attempts.count({
      where: { user_id: userId, attempted_at: { gte: now - hourWindow } },
    })
    await prisma.key_bind_attempts.create({
      data: { id: randomUUID(), user_id: userId, attempted_at: now },
    })
    if (hourCount >= cfg.perHour) {
      const oldest = await prisma.key_bind_attempts.findFirst({
        where: { user_id: userId, attempted_at: { gte: now - hourWindow } },
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
