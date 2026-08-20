// Abuse throttle for the hosted MCP serving endpoint (U4).
import { randomUUID } from 'node:crypto'
import type { PrismaDb } from '../db/prisma-client.js'

export interface McpRateLimitConfig {
  tokenPerMinute: number
  ipPerMinute: number
  globalPerMinute: number
}

const DEFAULTS: McpRateLimitConfig = {
  tokenPerMinute: 120,
  ipPerMinute: 600,
  globalPerMinute: 3000,
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw == null || raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return n
}

export function loadMcpRateLimitConfig(): McpRateLimitConfig {
  return {
    tokenPerMinute: readPositiveInt('SKILLET_MCP_RATE_PER_MINUTE', DEFAULTS.tokenPerMinute),
    ipPerMinute: readPositiveInt('SKILLET_MCP_RATE_IP_PER_MINUTE', DEFAULTS.ipPerMinute),
    globalPerMinute: readPositiveInt(
      'SKILLET_MCP_RATE_GLOBAL_PER_MINUTE',
      DEFAULTS.globalPerMinute,
    ),
  }
}

const WINDOW_SEC = 60

export type McpRateVerdict =
  | { limited: false }
  | { limited: true; scope: 'token' | 'ip' | 'global'; limit: number; retryAfterSeconds: number }

function retryAfter(oldestEpoch: number | null, nowEpoch: number): number {
  if (oldestEpoch == null) return WINDOW_SEC
  const wait = oldestEpoch + WINDOW_SEC - nowEpoch
  return wait < 1 ? 1 : wait
}

/**
 * Fail-closed stand-in for residual dual-path MCP callers outside U2.
 */
export function checkMcpRateLimit(
  _db: unknown,
  _linkId: string,
  _ip: string,
): McpRateVerdict {
  throw new Error('sqlite registry store removed; use checkMcpRateLimitPrisma')
}

/** Prisma twin of checkMcpRateLimit for the MySQL serve path. */
export async function checkMcpRateLimitPrisma(
  prisma: PrismaDb,
  linkId: string,
  ip: string,
): Promise<McpRateVerdict> {
  const cfg = loadMcpRateLimitConfig()
  const now = Math.floor(Date.now() / 1000)
  const since = now - WINDOW_SEC

  const [tokenCount, ipCount, globalCount] = await Promise.all([
    prisma.mcp_call_attempts.count({
      where: { link_id: linkId, attempted_at: { gte: since } },
    }),
    prisma.mcp_call_attempts.count({
      where: { ip, attempted_at: { gte: since } },
    }),
    prisma.mcp_call_attempts.count({
      where: { attempted_at: { gte: since } },
    }),
  ])

  await prisma.mcp_call_attempts.create({
    data: { id: randomUUID(), ip, link_id: linkId, attempted_at: now },
  })
  await prisma.mcp_call_attempts.deleteMany({
    where: { attempted_at: { lt: now - 2 * WINDOW_SEC } },
  })

  if (tokenCount >= cfg.tokenPerMinute) {
    const oldest = await prisma.mcp_call_attempts.findFirst({
      where: { link_id: linkId, attempted_at: { gte: since } },
      orderBy: { attempted_at: 'asc' },
      select: { attempted_at: true },
    })
    return {
      limited: true,
      scope: 'token',
      limit: cfg.tokenPerMinute,
      retryAfterSeconds: retryAfter(oldest?.attempted_at ?? null, now),
    }
  }

  if (ipCount >= cfg.ipPerMinute) {
    const oldest = await prisma.mcp_call_attempts.findFirst({
      where: { ip, attempted_at: { gte: since } },
      orderBy: { attempted_at: 'asc' },
      select: { attempted_at: true },
    })
    return {
      limited: true,
      scope: 'ip',
      limit: cfg.ipPerMinute,
      retryAfterSeconds: retryAfter(oldest?.attempted_at ?? null, now),
    }
  }

  if (globalCount >= cfg.globalPerMinute) {
    return {
      limited: true,
      scope: 'global',
      limit: cfg.globalPerMinute,
      retryAfterSeconds: WINDOW_SEC,
    }
  }

  return { limited: false }
}
