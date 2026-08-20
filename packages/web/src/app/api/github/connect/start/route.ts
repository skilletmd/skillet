import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { readAuthGithubCredentials } from '@/lib/oauth-env'
import { safeRedirectPath } from '@/lib/auth-errors'

export const GH_REPO_STATE_COOKIE = 'gh_repo_state'
export const GH_REPO_RETURN_COOKIE = 'gh_repo_return'

/** Same-origin relative return paths only (rejects //evil.com, /\evil.com, absolute). */
function safeReturn(raw: string | null): string {
  return safeRedirectPath(raw ?? undefined, '/settings/github')
}

/**
 * Incremental authorization: a SEPARATE GitHub OAuth grant fired only when the
 * user clicks "Connect a GitHub repo" — never bundled into sign-in. We request
 * NO scope: a no-scope token is GitHub's read-only-public ceiling, which is all
 * this feature needs — it lists the user's public repos (with the `permissions`
 * object), proves ownership via `permissions.push`, and reads public content.
 * We never write to GitHub, so we never ask for write. See
 * docs/plans/connect-your-repo.md and the one-connection/minimal-scope refactor.
 */
export async function GET(req: Request) {
  const creds = readAuthGithubCredentials()
  if (!creds) redirect('/settings/github?error=github_unconfigured')

  const reqUrl = new URL(req.url)
  const origin = reqUrl.origin
  const state = randomUUID()
  const jar = await cookies()
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 600,
  }
  jar.set(GH_REPO_STATE_COOKIE, state, cookieOpts)
  jar.set(GH_REPO_RETURN_COOKIE, safeReturn(reqUrl.searchParams.get('return')), cookieOpts)

  const authorize = new URL('https://github.com/login/oauth/authorize')
  authorize.searchParams.set('client_id', creds.id)
  // No scope: read-only public access. Listing repos + ownership verification +
  // content reads all work on a no-scope token; we never write, so we never ask.
  authorize.searchParams.set('scope', '')
  authorize.searchParams.set('redirect_uri', `${origin}/api/github/connect/callback`)
  authorize.searchParams.set('state', state)
  redirect(authorize.toString())
}
