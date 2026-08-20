import { revokeRegistrySession } from '@/lib/registry-session'
import { clearSessionCookie, readSessionCookie } from '@/lib/session-cookie'

type CookieJar = Parameters<typeof readSessionCookie>[0] & Parameters<typeof clearSessionCookie>[0]

export async function completeWebSignOut(jar: CookieJar, jwtSessionToken?: string): Promise<void> {
  const cookieToken = readSessionCookie(jar)
  const token = jwtSessionToken ?? cookieToken
  try {
    if (token) await revokeRegistrySession(token)
  } catch {
    // Best-effort revoke — local cookie clear must not depend on registry.
  } finally {
    clearSessionCookie(jar)
  }
}
