import { siteUrl } from '@/lib/site-url'

/** Map Auth.js `?error=` codes to copy for the sign-in page. */
export function authErrorMessage(code: string | undefined): string | null {
  if (!code) return null

  switch (code) {
    case 'OAuthAccountNotLinked':
      return 'This email is already linked to a different sign-in method. Use the provider you signed up with, or link accounts from settings after signing in.'
    case 'AccessDenied':
      return 'Sign in was cancelled. Choose a provider below to continue.'
    case 'Configuration':
      return 'Sign in is not fully configured yet. Check provider credentials or try again later.'
    case 'OAuthSignin':
    case 'OAuthCallback':
    case 'OAuthCreateAccount':
      return 'We could not complete sign in with that provider. Try again or use the other provider.'
    case 'MagicLinkInvalid':
      return 'This sign-in link is invalid or expired. Request a new one below.'
    case 'MagicLinkMissing':
      return 'This sign-in link is incomplete. Request a new one below.'
    default:
      return 'Something went wrong during sign in. Try again.'
  }
}

/**
 * Origins that count as "this site" for an absolute redirect target. `siteUrl()`
 * is the canonical one; `AUTH_URL` / `NEXTAUTH_URL` are added because Auth.js
 * builds its own absolute URLs from them, so they are exactly the values that
 * can come back to us.
 */
function sameSiteOrigins(): string[] {
  const raw = [siteUrl(), process.env.AUTH_URL, process.env.NEXTAUTH_URL]
  const origins: string[] = []
  for (const value of raw) {
    const trimmed = value?.trim()
    if (!trimmed) continue
    try {
      const { origin } = new URL(trimmed)
      if (!origins.includes(origin)) origins.push(origin)
    } catch {
      /* not a parseable URL — ignore */
    }
  }
  return origins
}

/**
 * Reduce a redirect target to a site-relative path, or `undefined` if it points
 * anywhere else.
 *
 * Relative input is returned untouched for the caller's guard to vet. Absolute
 * input is accepted ONLY when its origin is one of ours, and is then downgraded
 * to path + query + hash. This matters because Auth.js always rewrites
 * `callbackUrl` to an ABSOLUTE url when it bounces to a custom `pages.signIn`
 * page (`/api/auth/signin?callbackUrl=/settings/github` →
 * `/login?callbackUrl=https://skillet.md/settings/github`). Rejecting those
 * outright silently dropped the real destination and sent the user to the
 * generic post-login default instead.
 *
 * Parsing is deliberately done with NO base url, so a protocol-relative
 * `//evil.com` throws rather than resolving against our own origin.
 */
function relativizeSameOrigin(raw: string): string | undefined {
  if (raw.startsWith('/')) return raw
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return undefined
  }
  if (!sameSiteOrigins().includes(url.origin)) return undefined
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * The single guard for post-login / connect redirect targets. We only allow a
 * same-origin RELATIVE path: it must start with exactly one `/`, contain no
 * backslash, and contain no control characters. Browsers treat `/\evil.com`
 * (and its `/%5Cevil.com` percent-decoded form) as a protocol-relative jump to
 * an external host, so a `//`-only check is not enough. An ABSOLUTE url on one
 * of our own origins is first reduced to its path; anything else falls back to
 * the safe default.
 */
export function safeRedirectPath(raw: string | undefined, fallback = '/settings'): string {
  const trimmed = raw?.trim()
  const path = trimmed ? relativizeSameOrigin(trimmed) : undefined
  if (
    !path ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(path)
  ) {
    return fallback
  }
  return path
}

/** Back-compat alias — post-login redirects default to /settings. */
export function safeCallbackPath(raw: string | undefined): string {
  return safeRedirectPath(raw, '/settings')
}

/** Same guard as safeCallbackPath, but returns undefined when the input is absent or unsafe. */
export function optionalSafeCallbackPath(raw: string | undefined | null): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  const path = relativizeSameOrigin(trimmed)
  if (
    !path ||
    !path.startsWith('/') ||
    path.startsWith('//') ||
    path.includes('\\') ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(path)
  ) {
    return undefined
  }
  return path === '/login' ? undefined : path
}
