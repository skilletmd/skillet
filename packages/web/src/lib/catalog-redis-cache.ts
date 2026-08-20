/**
 * Shared Redis cache for browse catalog SSR payloads.
 *
 * Fail-open: unset Redis config, connect errors, and command failures all
 * behave as a miss so the registry fetch path still runs. TTL matches the
 * ~60s catalog freshness we already accept on Next / CF layers.
 *
 * Prod: ioredis + Redis Sentinel (see redis-connection.ts), same shape as
 * nft-generator. Local: REDIS_URL / SKILLET_REDIS_URL.
 */

import 'server-only'
import type Redis from 'ioredis'
import { createCatalogRedisClient } from './redis-connection'
import { logRegistryDegrade } from './registry-errors'
import { browseSsrLog, browseSsrProbeClock } from './browse-ssr-probe'

export const CATALOG_REDIS_TTL_SEC = 60
const KEY_PREFIX = 'skillet:catalog:v1:'

/** undefined = not attempted yet; null = disabled / failed. */
let clientPromise: Promise<Redis | null> | undefined

async function connectClient(): Promise<Redis | null> {
  const started = browseSsrProbeClock()
  try {
    const client = createCatalogRedisClient()
    if (!client) {
      browseSsrLog('redis_connect', {
        outcome: 'skip',
        ms: started ? browseSsrProbeClock() - started : undefined,
      })
      return null
    }
    // lazyConnect: connect on first command, but probe now so a bad Sentinel
    // config fails once at boot of the cache path rather than every get.
    if (client.status === 'wait') await client.connect()
    browseSsrLog('redis_connect', {
      outcome: 'ok',
      status: client.status,
      ms: started ? browseSsrProbeClock() - started : undefined,
    })
    return client
  } catch (cause) {
    browseSsrLog('redis_connect', {
      outcome: 'error',
      ms: started ? browseSsrProbeClock() - started : undefined,
      error: cause instanceof Error ? cause.message : String(cause),
    })
    logRegistryDegrade('catalog redis connect failed', cause)
    return null
  }
}

function getClient(): Promise<Redis | null> {
  if (!clientPromise) clientPromise = connectClient()
  return clientPromise
}

/** Test hook — drop the cached client so the next call re-reads env. */
export function resetCatalogRedisForTests(): void {
  clientPromise = undefined
}

export function catalogRedisKey(ioKey: string): string {
  return `${KEY_PREFIX}${ioKey}`
}

/** Return parsed JSON for `ioKey`, or undefined on miss / Redis unavailable. */
export async function catalogRedisGet<T>(ioKey: string): Promise<T | undefined> {
  const started = browseSsrProbeClock()
  const keyHint = ioKey.length > 96 ? `${ioKey.slice(0, 96)}…` : ioKey
  try {
    const client = await getClient()
    if (!client) {
      browseSsrLog('redis_get', {
        outcome: 'skip',
        key: keyHint,
        ms: started ? browseSsrProbeClock() - started : undefined,
      })
      return undefined
    }
    const getStarted = browseSsrProbeClock()
    const raw = await client.get(catalogRedisKey(ioKey))
    if (raw == null || raw === '') {
      browseSsrLog('redis_get', {
        outcome: 'miss',
        key: keyHint,
        get_ms: getStarted ? browseSsrProbeClock() - getStarted : undefined,
        ms: started ? browseSsrProbeClock() - started : undefined,
      })
      return undefined
    }
    const parsed = JSON.parse(raw) as T
    browseSsrLog('redis_get', {
      outcome: 'hit',
      key: keyHint,
      get_ms: getStarted ? browseSsrProbeClock() - getStarted : undefined,
      ms: started ? browseSsrProbeClock() - started : undefined,
    })
    return parsed
  } catch (cause) {
    browseSsrLog('redis_get', {
      outcome: 'error',
      key: keyHint,
      ms: started ? browseSsrProbeClock() - started : undefined,
      error: cause instanceof Error ? cause.message : String(cause),
    })
    logRegistryDegrade('catalog redis get failed', cause)
    return undefined
  }
}

/** Store JSON for `ioKey` with the catalog TTL. No-op when Redis is unavailable. */
export async function catalogRedisSet(ioKey: string, value: unknown): Promise<void> {
  try {
    const client = await getClient()
    if (!client) return
    await client.set(
      catalogRedisKey(ioKey),
      JSON.stringify(value),
      'EX',
      CATALOG_REDIS_TTL_SEC,
    )
  } catch (cause) {
    logRegistryDegrade('catalog redis set failed', cause)
  }
}
