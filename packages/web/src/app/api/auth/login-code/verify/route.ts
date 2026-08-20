import { cookies } from 'next/headers'
import { signIn } from '@/auth'
import { skilletSessionCookieOptions, SKILLET_SESSION_COOKIE } from '@/lib/session-cookie'
import { REGISTRY_API } from '@/lib/registry-prefix'
import { resolvePostLoginPath } from '@/lib/post-login-redirect'
import { hasClaimedHandle, isHandleGatedPath } from '@/lib/activity-gate'
import { fetchRegistryWhoami } from '@/lib/registry-session'
import { optionalSafeCallbackPath } from '@/lib/auth-errors'
import { isCrossOriginPost } from '@/lib/request-origin'

function registryUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

// Verify an emailed sign-in code. The registry burns the code single-use and
// creates-or-signs-in the email-verified identity; on success we set the session
// cookie and establish the Auth.js session, then return the post-login
// destination for the client to navigate to. Cross-origin POSTs are rejected
// (login-CSRF), mirroring the OAuth/magic-link callback guard.
export async function POST(req: Request) {
  if (isCrossOriginPost(req)) {
    return Response.json({ ok: false, error: 'cross_origin' }, { status: 403 })
  }

  const { email, code, callbackUrl } = (await req.json().catch(() => ({}))) as {
    email?: string
    code?: string
    callbackUrl?: string
  }

  const res = await fetch(`${registryUrl()}${REGISTRY_API}/auth/login-code/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: (email ?? '').trim(), code: (code ?? '').trim() }),
  })

  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    return Response.json(
      { ok: false, error: err.error ?? 'invalid_or_expired_code' },
      {
        status: res.status,
      },
    )
  }

  const body = (await res.json()) as { session_token: string }
  const jar = await cookies()
  jar.set(SKILLET_SESSION_COOKIE, body.session_token, skilletSessionCookieOptions)

  // Only a handle-gated callback (e.g. /notifications) needs the handle check —
  // a brand-new account with no username can't render it, so divert to /settings
  // to claim one. For every other destination, skip the whoami (signIn's
  // authorize does one anyway) and let the callback stand. A whoami blip leaves
  // hasHandle undefined so the callback is honored and the proxy gate backstops.
  const safeCallback = optionalSafeCallbackPath(callbackUrl)
  let hasHandle: boolean | undefined
  if (safeCallback && isHandleGatedPath(safeCallback)) {
    const who = await fetchRegistryWhoami(body.session_token)
    hasHandle = who ? hasClaimedHandle(who.handle) : undefined
  }
  const redirectTo = resolvePostLoginPath({ callbackUrl: safeCallback, hasHandle })
  await signIn('registry', { sessionToken: body.session_token, redirect: false })

  return Response.json({ ok: true, redirectTo })
}
