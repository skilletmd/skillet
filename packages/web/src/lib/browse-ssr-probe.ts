/**
 * Flag-gated browse SSR diagnostics for prod stampede / 503 rides.
 * SKILLET_BROWSE_SSR_PROBE=1 (or legacy SKILLET_CATALOG_GATE_LOG=1) enables
 * [browse-ssr] lines on stdout. Flag-off: no timers beyond cheap env checks.
 *
 * When a page runs inside withBrowseSsrProbe(), every line carries rid +
 * elapsed_ms so stampede logs can be correlated across proxy / layout / auth /
 * bootstrap / redis / gate / fetch / soft_fail.
 *
 * Wall-clock sampling must not run during `next build` prerender — cacheComponents
 * rejects Date.now() before uncached/request IO (breaks /home, /stats, etc.).
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export const BROWSE_SSR_PROBE_ENV = 'SKILLET_BROWSE_SSR_PROBE'
/** Request header set by proxy.ts so layout + page share one rid. */
export const BROWSE_SSR_RID_HEADER = 'x-browse-ssr-rid'

type BrowseSsrProbeCtx = {
  rid: string
  pageStarted: number
}

const probeStore = new AsyncLocalStorage<BrowseSsrProbeCtx>()

export function isBrowseSsrProbeEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env[BROWSE_SSR_PROBE_ENV] === '1' || env.SKILLET_CATALOG_GATE_LOG === '1'
}

/** True while Next is statically prerendering for a production build. */
export function isNextProductionBuildPhase(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.NEXT_PHASE === 'phase-production-build'
}

/**
 * Sample wall clock for probe spans. Returns 0 when the probe is off or during
 * production-build prerender (where Date.now() is forbidden before dynamic IO).
 */
export function browseSsrProbeClock(
  env: Record<string, string | undefined> = process.env,
): number {
  if (!isBrowseSsrProbeEnabled(env)) return 0
  if (isNextProductionBuildPhase(env)) return 0
  return Date.now()
}

/** Short request id for correlating [browse-ssr] lines under stampede. */
export function newBrowseSsrRequestId(): string {
  return crypto.randomUUID().slice(0, 8)
}

/**
 * Run browse SSR work with a shared rid + page clock. No-op wrapper when the
 * probe flag is off (no ALS overhead on the hot path). Reuses an existing ALS
 * context so nested wrappers (layout → page) keep the same rid when ALS
 * propagates; pass `rid` to align with the proxy header across React trees.
 */
export function withBrowseSsrProbe<T>(fn: () => Promise<T>, rid?: string): Promise<T> {
  if (!isBrowseSsrProbeEnabled()) return fn()
  const existing = probeStore.getStore()
  if (existing) return fn()
  return probeStore.run(
    { rid: rid ?? newBrowseSsrRequestId(), pageStarted: browseSsrProbeClock() },
    fn,
  )
}

export function browseSsrProbeCtx(): BrowseSsrProbeCtx | undefined {
  return probeStore.getStore()
}

/**
 * Tracer bullet: log `{stage}_start`, run `fn`, log `{stage}_done` (or `_throw`)
 * with duration. No-op when the probe flag is off.
 */
export async function browseSsrSpan<T>(
  stage: string,
  fn: () => Promise<T>,
  fields?: Record<string, unknown>,
): Promise<T> {
  if (!isBrowseSsrProbeEnabled()) return fn()
  const started = browseSsrProbeClock()
  browseSsrLog(`${stage}_start`, fields)
  try {
    const value = await fn()
    browseSsrLog(`${stage}_done`, {
      ...fields,
      ms: started ? browseSsrProbeClock() - started : undefined,
    })
    return value
  } catch (cause) {
    browseSsrLog(`${stage}_throw`, {
      ...fields,
      ms: started ? browseSsrProbeClock() - started : undefined,
      error: cause instanceof Error ? cause.message : String(cause),
      name: cause instanceof Error ? cause.name : undefined,
    })
    throw cause
  }
}

/**
 * Emit a [browse-ssr] line. Prefer (event, fieldsObject). String details stay
 * as a third arg so existing gate_join(key) call sites keep working.
 */
export function browseSsrLog(event: string, detail?: unknown): void {
  if (!isBrowseSsrProbeEnabled()) return
  const ctx = probeStore.getStore()
  const now = browseSsrProbeClock()
  const meta = ctx
    ? {
        rid: ctx.rid,
        ...(ctx.pageStarted > 0 && now > 0 ? { elapsed_ms: now - ctx.pageStarted } : {}),
      }
    : undefined

  if (detail !== undefined && typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
    console.info('[browse-ssr]', event, { ...meta, ...(detail as Record<string, unknown>) })
    return
  }
  if (detail !== undefined) {
    if (meta) console.info('[browse-ssr]', event, meta, detail)
    else console.info('[browse-ssr]', event, detail)
    return
  }
  if (meta) console.info('[browse-ssr]', event, meta)
  else console.info('[browse-ssr]', event)
}

/** Host+path only — never dump query strings with tokens. */
export function browseSsrSafeUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname}`
  } catch {
    return '(invalid-url)'
  }
}

/** One-shot Redis mode summary for origin logs (no secrets). */
export function browseSsrRedisConfigSummary(
  env: Record<string, string | undefined> = process.env,
): Record<string, string | number | boolean> {
  const sentinelRaw = (env.REDIS_SENTINELS ?? '').trim()
  let sentinelCount = 0
  if (sentinelRaw) {
    try {
      const parsed: unknown = JSON.parse(sentinelRaw)
      if (Array.isArray(parsed)) sentinelCount = parsed.length
    } catch {
      sentinelCount = -1
    }
  }
  const hasUrl = Boolean(env.SKILLET_REDIS_URL?.trim() || env.REDIS_URL?.trim())
  return {
    redis_prod: env.REDIS_PROD === 'true',
    sentinel_count: sentinelCount,
    main_name_set: Boolean((env.REDIS_MAIN_NAME ?? '').trim()),
    direct_url_set: hasUrl,
  }
}
