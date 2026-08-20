/**
 * Process-local singleflight + concurrency gate for outbound catalog registry
 * fetches. Softens browse SSR stampede: identical keys share one Promise, and
 * distinct keys cannot unbounded-parallelize undici work from this Node process.
 *
 * An overall AbortSignal.timeout covers both gate wait and the fetch so a
 * queued SSR request soft-fails before Cloudflare's origin timeout (503).
 */

import { browseSsrLog, browseSsrProbeClock } from './browse-ssr-probe'

const DEFAULT_CONCURRENCY = 3
/** Wall budget for gate wait + registry fetch. Under CF ~100s; stay far below. */
const DEFAULT_TIMEOUT_MS = 4_000

const inflight = new Map<string, Promise<unknown>>()
let active = 0
const waitQueue: Array<() => void> = []

function resolveConcurrency(): number {
  const raw = process.env.SKILLET_CATALOG_FETCH_CONCURRENCY
  if (raw === undefined || raw === '') return DEFAULT_CONCURRENCY
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY
  return Math.floor(n)
}

/** Catalog SSR wall-clock budget (gate wait + fetch). Env override for rides. */
export function resolveCatalogFetchTimeoutMs(): number {
  const raw = process.env.SKILLET_CATALOG_FETCH_TIMEOUT_MS
  if (raw === undefined || raw === '') return DEFAULT_TIMEOUT_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_TIMEOUT_MS
  return Math.floor(n)
}

function catalogAbortError(): DOMException {
  return new DOMException('Catalog fetch aborted', 'AbortError')
}

async function acquire(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw catalogAbortError()
  const max = resolveConcurrency()
  if (active < max) {
    active += 1
    return
  }
  const waitStarted = browseSsrProbeClock()
  browseSsrLog('gate_wait', { active, waiting: waitQueue.length + 1, max })
  await new Promise<void>((resolve, reject) => {
    const entry = () => {
      signal.removeEventListener('abort', onAbort)
      if (waitStarted) {
        browseSsrLog('gate_acquired', {
          wait_ms: browseSsrProbeClock() - waitStarted,
          active,
          waiting: waitQueue.length,
          max,
        })
      }
      resolve()
    }
    const onAbort = () => {
      const idx = waitQueue.indexOf(entry)
      if (idx >= 0) waitQueue.splice(idx, 1)
      reject(catalogAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    waitQueue.push(entry)
  })
}

function release(): void {
  const next = waitQueue.shift()
  if (next) {
    // Transfer the slot to the waiter; active count stays the same.
    next()
    return
  }
  active = Math.max(0, active - 1)
}

/**
 * Run `fn` under singleflight(key), the global catalog concurrency gate, and a
 * wall-clock AbortSignal that covers both wait and work.
 */
export async function runCatalogFetch<T>(
  key: string,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const existing = inflight.get(key)
  if (existing) {
    browseSsrLog('gate_join', key)
    return existing as Promise<T>
  }

  const signal = AbortSignal.timeout(resolveCatalogFetchTimeoutMs())

  const promise = (async () => {
    await acquire(signal)
    try {
      if (signal.aborted) throw catalogAbortError()
      return await fn(signal)
    } finally {
      release()
    }
  })()

  inflight.set(key, promise)
  try {
    return await promise
  } finally {
    // Only delete if we still own this slot — a replacement retry may have raced in.
    if (inflight.get(key) === promise) inflight.delete(key)
  }
}

/** Build a stable catalog IO key from route + query string. */
export function catalogFetchKey(route: string, search: string): string {
  return `${route}?${search}`
}

/** Test-only reset of process-local gate state. */
export function resetCatalogFetchGateForTests(): void {
  inflight.clear()
  active = 0
  waitQueue.length = 0
}

/** Test-only snapshot for concurrency assertions. */
export function catalogFetchGateStatsForTests(): {
  active: number
  inflight: number
  waiting: number
} {
  return { active, inflight: inflight.size, waiting: waitQueue.length }
}
