import { readAuthGithubCredentials, readAuthGoogleCredentials } from '@/lib/oauth-env'

/**
 * Boot-time posture checks for OAuth config.
 *
 * These providers are OPTIONAL (a self-host may run on email login alone), so a
 * missing one must not stop the server. But a missing one must not be silent
 * either: production ran with the GitHub credentials under the wrong env names
 * (`AUTH_GITHUB_CLIENT_ID` instead of `AUTH_GITHUB_ID`), so Auth.js never
 * registered the provider. `signIn('github')` then fell through next-auth's
 * unknown-provider path to /api/auth/signin, which bounced to /login, which
 * bounced a signed-in user to the post-login default. A live Connect button
 * that quietly lands on the feed, and nothing in any log.
 */
export function register() {
  // Only the Node.js server runtime has the env; the edge copy would re-warn.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const missing: string[] = []
  if (!readAuthGithubCredentials()) missing.push('GitHub (AUTH_GITHUB_ID / AUTH_GITHUB_SECRET)')
  if (!readAuthGoogleCredentials()) missing.push('Google (AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET)')

  if (missing.length > 0) {
    console.warn(
      `auth-providers: not configured, so its buttons cannot work: ${missing.join('; ')}. ` +
        'Email login is unaffected. Check for the credentials under near-miss names ' +
        '(AUTH_GITHUB_CLIENT_ID is NOT the name Auth.js reads).',
    )
  }
}
