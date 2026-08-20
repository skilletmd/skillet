import { randomUUID } from 'node:crypto'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { readAuthGithubCredentials } from '@/lib/oauth-env'
import { safeRedirectPath } from '@/lib/auth-errors'
import { safeClaimHandle } from '@/lib/gh-claim-handle'

export const GH_CLAIM_STATE_COOKIE = 'gh_claim_state'
export const GH_CLAIM_RETURN_COOKIE = 'gh_claim_return'
export const GH_CLAIM_HANDLE_COOKIE = 'gh_claim_handle'

/** Same-origin relative return path; defaults to the brand page for the handle. */
function safeReturn(raw: string | null, handle: string | null): string {
  return safeRedirectPath(raw ?? undefined, handle ? `/${handle}` : '/')
}

/**
 * Brand-claim GitHub grant — START. A SEPARATE incremental OAuth grant from
 * the no-scope repo-connect flow (api/github/connect/*): this one requests
 * `scope=read:org` so the callback can prove, from the claimant's OWN token, that
 * they are a GitHub org owner of / repo admin on the mirror's source. The
 * read:org token is request-scoped and discarded after the check — it is
 * never stored. Mirrors connect/start exactly except the scope, the cookie names,
 * and the `?handle=` brand param.
 */
export async function GET(req: Request) {
  const reqUrl = new URL(req.url)
  const handle = safeClaimHandle(reqUrl.searchParams.get('handle'))
  const returnTo = safeReturn(reqUrl.searchParams.get('return'), handle)

  const creds = readAuthGithubCredentials()
  if (!creds) redirect(`${returnTo}?claim=github_unconfigured`)
  if (!handle) redirect('/?claim=invalid_handle')

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
  jar.set(GH_CLAIM_STATE_COOKIE, state, cookieOpts)
  jar.set(GH_CLAIM_RETURN_COOKIE, returnTo, cookieOpts)
  jar.set(GH_CLAIM_HANDLE_COOKIE, handle!, cookieOpts)

  const authorize = new URL('https://github.com/login/oauth/authorize')
  authorize.searchParams.set('client_id', creds!.id)
  // read:org: lets the callback read the claimant's org membership/role and the
  // repo `permissions` object to verify ownership-grade control.
  // user:email: lets the callback read the claimant's verified primary email,
  // needed only for the logged-OUT account-bootstrap path (a personal/User-source
  // mirror minting a fresh account that must pass the verified-email gate). We
  // never write, and the token is discarded after the check.
  authorize.searchParams.set('scope', 'read:org user:email')
  authorize.searchParams.set('redirect_uri', `${origin}/api/github/claim-org/callback`)
  authorize.searchParams.set('state', state)
  redirect(authorize.toString())
}
