import { redirect } from 'next/navigation'
import { getSession } from '@/lib/get-session'

/**
 * Require a signed-in session for a server page. Returns the session (with a
 * guaranteed `user`), or redirects to /login (returning to `callbackUrl` after
 * sign-in) when there's none. Built on the request-cached {@link getSession} so
 * the decode is shared, and encodes `callbackUrl` here so every call site stays
 * consistent.
 */
export async function requireSession(callbackUrl: string) {
  const session = await getSession()
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }
  // `session` is non-null past the guard; assert `user` is present for callers
  // while preserving the augmented session shape (handle, etc.).
  return session as typeof session & { user: NonNullable<(typeof session)['user']> }
}

/**
 * Require a signed-in session that has claimed a username, for pages that can't
 * render without a public identity (notifications, updates). A signed-out viewer
 * goes to /login; a signed-in one who hasn't picked a username goes to /settings
 * to claim one. Sending the latter to /login would loop — the login page bounces
 * an existing session straight back to `callbackUrl`, which redirects here again.
 */
export async function requireHandle(callbackUrl: string) {
  const session = await getSession()
  if (!session?.user) {
    redirect(`/login?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  }
  if (!session.handle) {
    redirect('/settings')
  }
  return session as typeof session & {
    user: NonNullable<(typeof session)['user']>
    handle: string
  }
}
