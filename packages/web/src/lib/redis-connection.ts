/**
 * Redis connection for web catalog SSR cache.
 *
 * Pattern mirrors nft-generator (ioredis): local uses REDIS_URL / SKILLET_REDIS_URL;
 * prod uses Redis Sentinel when REDIS_PROD=true (or REDIS_SENTINELS is set).
 * No hardcoded sentinel hosts — set REDIS_SENTINELS as JSON in the env.
 */

import 'server-only'
import Redis from 'ioredis'
import { logRegistryDegrade } from './registry-errors'

export type SentinelHost = { host: string; port: number }

/** True when we should talk to Sentinel instead of a direct URL. */
export function useRedisSentinel(): boolean {
  if (process.env.REDIS_PROD === 'true') return true
  if ((process.env.REDIS_SENTINELS ?? '').trim()) return true
  return false
}

function parseSentinels(raw: string): SentinelHost[] | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const out: SentinelHost[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') return null
      const host = (entry as { host?: unknown }).host
      const port = (entry as { port?: unknown }).port
      if (typeof host !== 'string' || !host.trim()) return null
      const n = typeof port === 'number' ? port : Number(port)
      if (!Number.isFinite(n) || n < 1) return null
      out.push({ host: host.trim(), port: Math.floor(n) })
    }
    return out
  } catch {
    return null
  }
}

function redisDb(): number {
  const n = Number(process.env.REDIS_CACHE_DB ?? '0')
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

function directRedisUrl(): string | undefined {
  const a = process.env.SKILLET_REDIS_URL?.trim()
  if (a) return a
  const b = process.env.REDIS_URL?.trim()
  return b || undefined
}

/**
 * Build an ioredis client, or null when Redis is not configured.
 * Callers must treat null as fail-open (cache miss / no-op set).
 */
export function createCatalogRedisClient(): Redis | null {
  if (useRedisSentinel()) {
    const raw = (process.env.REDIS_SENTINELS ?? '').trim()
    if (!raw) {
      logRegistryDegrade(
        'catalog redis sentinel mode on but REDIS_SENTINELS is unset/empty',
      )
      return null
    }
    const sentinels = parseSentinels(raw)
    if (!sentinels) {
      logRegistryDegrade('catalog redis REDIS_SENTINELS is not valid JSON host/port list')
      return null
    }
    const name = (process.env.REDIS_MAIN_NAME ?? 'mymaster').trim() || 'mymaster'
    const client = new Redis({
      sentinels,
      name,
      password: process.env.REDIS_PASSWORD || undefined,
      db: redisDb(),
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      lazyConnect: true,
    })
    client.on('error', (err: Error) => {
      logRegistryDegrade('catalog redis sentinel client error', err)
    })
    return client
  }

  const url = directRedisUrl()
  if (!url) return null

  const client = new Redis(url, {
    db: redisDb(),
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
  })
  client.on('error', (err: Error) => {
    logRegistryDegrade('catalog redis client error', err)
  })
  return client
}

/** Exported for unit tests of sentinel JSON parsing. */
export function parseRedisSentinelsForTests(raw: string): SentinelHost[] | null {
  return parseSentinels(raw)
}
