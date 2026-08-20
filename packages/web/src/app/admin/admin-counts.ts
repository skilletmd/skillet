import 'server-only'
import { cookies } from 'next/headers'
import { readSessionCookie } from '@/lib/session-cookie'
import { REGISTRY_API } from '@/lib/registry-prefix'

function registryUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

export interface AdminCounts {
  /** Mirror candidates awaiting review; null if the count couldn't be loaded. */
  pendingMirror: number | null
  /** Skills with open reports; null if the count couldn't be loaded. */
  openReports: number | null
}

/** Derive the overview counts from the two admin API responses. A response that
 *  isn't the expected `{ pending: [] }` / `{ groups: [] }` shape (a failed fetch
 *  returns null) yields a null count, rendered as "—" rather than a wrong zero. */
export function deriveAdminCounts(mirror: unknown, reports: unknown): AdminCounts {
  const pending = (mirror as { pending?: unknown })?.pending
  const groups = (reports as { groups?: unknown })?.groups
  return {
    pendingMirror: Array.isArray(pending) ? pending.length : null,
    openReports: Array.isArray(groups) ? groups.length : null,
  }
}

/**
 * Best-effort operational counts for the /admin overview. Reuses the same admin
 * registry endpoints the mirror/reports pages call. A failed fetch yields null
 * (rendered as "—") so the overview never hard-errors on a transient registry blip.
 */
export async function fetchAdminCounts(): Promise<AdminCounts> {
  const jar = await cookies()
  const token = readSessionCookie(jar)
  if (!token) return { pendingMirror: null, openReports: null }
  const headers = { authorization: `Bearer ${token}`, accept: 'application/json' }
  const [mirror, reports] = await Promise.all([
    fetch(`${registryUrl()}${REGISTRY_API}/admin/mirror-queue`, { headers, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    fetch(`${registryUrl()}${REGISTRY_API}/admin/reports`, { headers, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
  ])
  return deriveAdminCounts(mirror, reports)
}
