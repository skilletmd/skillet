import 'server-only'
import { cookies } from 'next/headers'
import { SKILLET_SESSION_COOKIE } from './session-cookie'
import { REGISTRY_API } from './registry-prefix'
import type { PersonCatalogEntry } from './registry'
import { registryFetchOrigin } from './registry-origin'
import { browseSsrLog, browseSsrProbeClock } from './browse-ssr-probe'

const REGISTRY_BASE_URL = registryFetchOrigin()

/**
 * The author handles the signed-in viewer follows, read from their session
 * token. Empty set when logged out or on any failure — follow state is a
 * progressive enhancement, never a hard dependency for rendering the catalog.
 * Server-only (reads cookies), so it lives apart from the shared registry lib.
 */
export async function getFollowedAuthorHandles(): Promise<Set<string>> {
  const started = browseSsrProbeClock()
  if (!REGISTRY_BASE_URL) {
    browseSsrLog('follows', { outcome: 'skip_no_registry', ms: 0 })
    return new Set()
  }
  const token = (await cookies()).get(SKILLET_SESSION_COOKIE)?.value
  if (!token) {
    browseSsrLog('follows', {
      outcome: 'skip_anon',
      ms: started ? browseSsrProbeClock() - started : undefined,
    })
    return new Set()
  }
  try {
    const res = await fetch(`${REGISTRY_BASE_URL}${REGISTRY_API}/me/following`, {
      headers: { authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      browseSsrLog('follows', {
        outcome: 'http_error',
        status: res.status,
        ms: started ? browseSsrProbeClock() - started : undefined,
      })
      return new Set()
    }
    const data = (await res.json()) as {
      following?: { subject_kind?: string; subject_id?: string }[]
    }
    const set = new Set(
      (data.following ?? [])
        .filter((f) => f.subject_kind === 'author' && typeof f.subject_id === 'string')
        .map((f) => String(f.subject_id)),
    )
    browseSsrLog('follows', {
      outcome: 'ok',
      count: set.size,
      ms: started ? browseSsrProbeClock() - started : undefined,
    })
    return set
  } catch (cause) {
    browseSsrLog('follows', {
      outcome: 'error',
      ms: started ? browseSsrProbeClock() - started : undefined,
      error: cause instanceof Error ? cause.message : String(cause),
    })
    return new Set()
  }
}

/** Stamp each person with whether the viewer follows them, given the followed set. */
export function withViewerFollows(
  people: PersonCatalogEntry[],
  followed: Set<string>,
): PersonCatalogEntry[] {
  return people.map((p) => ({ ...p, viewerFollows: followed.has(p.handle) }))
}
