import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { readAuthGithubCredentials } from '@/lib/oauth-env'
import { readSessionCookie } from '@/lib/session-cookie'
import { storeGithubConnectToken } from '@/lib/connected-repos'
import { safeRedirectPath } from '@/lib/auth-errors'
import { GH_REPO_STATE_COOKIE, GH_REPO_RETURN_COOKIE } from '../start/route'

export const GH_REPO_TOKEN_COOKIE = 'gh_repo_token'

/**
 * Completes the repo-connect grant: verify state, exchange the code for a
 * read-only (no-scope) token, stash it briefly (httpOnly) so the connect form
 * can use it, and bounce back to Settings. The token is short-lived in the
 * cookie; the registry re-stores it encrypted once a repo is actually connected.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const jar = await cookies()
  const expectedState = jar.get(GH_REPO_STATE_COOKIE)?.value

  if (!code || !state || !expectedState || state !== expectedState) {
    redirect('/settings/github?error=oauth_state')
  }
  jar.delete(GH_REPO_STATE_COOKIE)

  const creds = readAuthGithubCredentials()
  if (!creds) redirect('/settings/github?error=github_unconfigured')

  let token: string | null = null
  try {
    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: creds!.id, client_secret: creds!.secret, code }),
    })
    const body = (await res.json()) as { access_token?: string }
    token = body.access_token ?? null
  } catch {
    redirect('/settings/github?error=oauth_exchange')
  }
  if (!token) redirect('/settings/github?error=oauth_no_token')

  // Persist the read-only token so the user stays "connected" without re-granting
  // on the next add (GitHub-sign-in users already have one from sign-in; this
  // covers everyone else). Best-effort — the cookie below still drives the
  // immediate connect even if this server→registry write fails.
  const sessionToken = readSessionCookie(jar)
  if (sessionToken) {
    try {
      await storeGithubConnectToken(sessionToken, token!)
    } catch {
      /* non-fatal: the cookie carries the token for the immediate connect */
    }
  }

  jar.set(GH_REPO_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 1800,
  })
  // Re-validate the stored return path before redirecting (defense in depth —
  // the start route already hardened it, but never redirect to an unvalidated value).
  const returnTo = safeRedirectPath(jar.get(GH_REPO_RETURN_COOKIE)?.value, '/settings/github')
  jar.delete(GH_REPO_RETURN_COOKIE)
  const sep = returnTo.includes('?') ? '&' : '?'
  redirect(`${returnTo}${sep}connected=github`)
}
