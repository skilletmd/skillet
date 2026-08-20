import { REGISTRY_API } from './registry-prefix'
import { logRegistryDegrade } from './registry-errors'

/**
 * Web BFF proxy paths for the registry (`/api/registry/[...path]` → registry origin).
 *
 * Every registry route — skill/catalog and auth/identity alike — is reached on
 * the canonical {@link REGISTRY_API} prefix. The two builders below are kept
 * distinct only to document which surface a caller is hitting; they produce the
 * same shape.
 */

/** Auth/identity routes (whoami, claim, orgs, magic-link, …). */
export function registryAuthApi(path: string): string {
  const suffix = path.replace(/^\//, '')
  return `/api/registry${REGISTRY_API}/${suffix}`
}

// Retry policy mirrors the defaults of `ky`/`axios-retry` so this stays a thin,
// conventional wheel rather than a bespoke one:
//
//  - Only idempotent methods are replayed. Retrying a POST/DELETE after a bare
//    network error (or a 504 where the origin actually processed the write) would
//    double-apply the mutation, so those surface the first outcome unretried.
//  - Transient statuses are the gateway/timeout/rate-limit family — a real client
//    error (4xx) or a deterministic 500-with-body is a stable answer, not a blip.
//    (413 is excluded: an over-limit payload never clears on retry.)
//  - A `Retry-After` header, when present, wins over our own backoff.
const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'])
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

const BASE_BACKOFF_MS = 300
const MAX_BACKOFF_MS = 3000

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError')
}

/** `Retry-After` (delta-seconds or HTTP-date) as ms from now, or null if absent. */
function retryAfterMs(res: Response): number | null {
  const raw = res.headers?.get('retry-after')
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const at = Date.parse(raw)
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now())
}

/**
 * Full-jitter exponential backoff (AWS "Exponential Backoff And Jitter"): a
 * uniform random draw in `[0, min(cap, base·2^attempt)]`. The jitter is the
 * point — several settings panels retry at once, and a fixed schedule would
 * make them stampede the origin in lockstep on every wave.
 */
function backoffMs(attempt: number): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt)
  return Math.round(Math.random() * ceiling)
}

/** Backoff that honors the abort signal so an unmount cancels the wait too. */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(id)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * `fetch` a registry proxy path, retrying transient gateway failures with a
 * jittered backoff before surfacing the response. Returns the final `Response`
 * (which the caller still inspects for `res.ok`); only a persistent failure or
 * a real network outage reaches the caller as an error. Aborts propagate
 * immediately and are never retried, and non-idempotent methods are never
 * replayed (see {@link RETRYABLE_METHODS}).
 *
 * Default: up to 2 retries (3 attempts total).
 */
export async function fetchRegistryWithRetry(
  path: string,
  opts?: { signal?: AbortSignal; retries?: number; init?: RequestInit },
): Promise<Response> {
  const retries = opts?.retries ?? 2
  const method = (opts?.init?.method ?? 'GET').toUpperCase()
  const methodRetryable = RETRYABLE_METHODS.has(method)
  for (let attempt = 0; ; attempt++) {
    if (opts?.signal?.aborted) throw abortError()
    let wait: number
    try {
      const res = await fetch(registryAuthApi(path), {
        credentials: 'include',
        // Spread caller init first, then re-assert the defaults that must not be
        // clobbered: `accept` merges under any caller headers, and `signal` is
        // ours (the retry loop owns cancellation).
        ...opts?.init,
        headers: { accept: 'application/json', ...opts?.init?.headers },
        signal: opts?.signal,
      })
      if (
        res.ok ||
        !methodRetryable ||
        !RETRYABLE_STATUS.has(res.status) ||
        attempt >= retries
      ) {
        return res
      }
      logRegistryDegrade(`proxy ${method} responded ${res.status}, retrying: ${path}`)
      wait = retryAfterMs(res) ?? backoffMs(attempt)
    } catch (cause) {
      // An abort (navigation / unmount) is intent, never a fault to retry past.
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
      if (!methodRetryable || attempt >= retries) throw cause
      logRegistryDegrade(`proxy ${method} failed, retrying: ${path}`, cause)
      wait = backoffMs(attempt)
    }
    await delay(wait, opts?.signal)
  }
}

/** Skill/catalog routes (skills, discover, search, profiles, …). */
export function registrySkillApi(path: string): string {
  const suffix = path.replace(/^\//, '')
  return `/api/registry${REGISTRY_API}/${suffix}`
}

/**
 * Raw bytes of one bundle file (the registry's `/files/*` route), same-origin
 * through the BFF proxy — so CSP `img-src 'self'` covers it and private-skill
 * auth rides the session cookie. Each path segment is encoded individually so
 * the in-bundle `/` separators survive as route structure.
 */
export function skillFileUrl(author: string, slug: string, versionHash: string, path: string): string {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/')
  return registrySkillApi(
    `skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionHash)}/files/${encodedPath}`,
  )
}

/**
 * GET a registry JSON resource from the browser, folding the boilerplate every
 * client component otherwise repeats: `credentials: 'include'`, the JSON accept
 * header, and a try/catch that returns `null` on any non-OK / network / parse
 * error.
 *
 * Callers that want a list default it: `(await registryGetJson<…>(…))?.items ?? []`.
 */
export async function registryGetJson<T>(
  path: string,
  opts?: { signal?: AbortSignal },
): Promise<T | null> {
  try {
    const res = await fetch(registryAuthApi(path), {
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal: opts?.signal,
    })
    if (!res.ok) {
      if (res.status !== 404) logRegistryDegrade(`proxy GET responded ${res.status}: ${path}`)
      return null
    }
    return (await res.json()) as T
  } catch (cause) {
    // An aborted request (navigation / unmount) is expected, not a fault.
    if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
      logRegistryDegrade(`proxy GET failed: ${path}`, cause)
    }
    return null
  }
}
