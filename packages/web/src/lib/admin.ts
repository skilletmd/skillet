import 'server-only'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/get-session'

/**
 * Admin authorization. There is no admin role in the data model yet, so admin is
 * an explicit env allowlist of handles (`SKILLET_ADMIN_HANDLES`) and/or stable
 * registry user ids (`SKILLET_ADMIN_USER_IDS`, comma-separated).
 * Empty/unset allowlist means NOBODY is admin — fail closed.
 */
export function adminHandles(): Set<string> {
  return new Set(
    (process.env.SKILLET_ADMIN_HANDLES ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  )
}

export function adminUserIds(): Set<string> {
  return new Set(
    (process.env.SKILLET_ADMIN_USER_IDS ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  )
}

export function isAdminHandle(handle: string | null | undefined): boolean {
  if (!handle) return false
  return adminHandles().has(handle.toLowerCase())
}

export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false
  return adminUserIds().has(userId)
}

export function isAdminPrincipal(auth: AdminProxyAuth | null | undefined): boolean {
  if (!auth) return false
  if (isAdminUserId(auth.registryUserId)) return true
  return isAdminHandle(auth.handle)
}

/** True when the current session belongs to an allowlisted admin. */
export async function isAdmin(): Promise<boolean> {
  const session = await getSession()
  return isAdminPrincipal({
    handle: session?.handle,
    registryUserId: session?.registryUserId,
  })
}

/**
 * Hard-fail any non-admin caller. Call at the top of every admin server action —
 * the middleware gate covers page routes, but a server action can be invoked
 * directly, so each one must re-check.
 */
export async function assertAdmin(): Promise<void> {
  if (!(await isAdmin())) {
    throw new Error('not_authorized')
  }
}

export interface AdminProxyAuth {
  handle?: string | null
  registryUserId?: string | null
}

/** Staff-only page prefixes gated by SKILLET_ADMIN_HANDLES (see proxy.ts). */
const STAFF_ROUTE_PREFIXES = ['/admin', '/internal'] as const

/**
 * Page-route gate for /admin and /internal used by src/proxy.ts. Returns a
 * redirect/404 response when the caller may not access staff routes; null to continue.
 */
export function adminProxyGate(
  pathname: string,
  auth: AdminProxyAuth | null | undefined,
  loginOrigin: string,
): NextResponse | null {
  if (!STAFF_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return null
  if (!auth) {
    const login = new URL('/login', loginOrigin)
    login.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(login)
  }
  if (!isAdminPrincipal(auth)) {
    return new NextResponse(null, { status: 404 })
  }
  return null
}
