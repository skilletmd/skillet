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
 * The single guard for post-login / connect redirect targets. We only allow a
 * same-origin RELATIVE path: it must start with exactly one `/`, contain no
 * backslash, and contain no control characters. Browsers treat `/\evil.com`
 * (and its `/%5Cevil.com` percent-decoded form) as a protocol-relative jump to
 * an external host, so a `//`-only check is not enough. Anything else falls
 * back to the safe default.
 */
export function safeRedirectPath(raw: string | undefined, fallback = '/settings'): string {
  if (
    !raw ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(raw)
  ) {
    return fallback
  }
  return raw
}

/** Back-compat alias — post-login redirects default to /settings. */
export function safeCallbackPath(raw: string | undefined): string {
  return safeRedirectPath(raw, '/settings')
}

/** Same guard as safeCallbackPath, but returns undefined when the input is absent or unsafe. */
export function optionalSafeCallbackPath(raw: string | undefined | null): string | undefined {
  const trimmed = raw?.trim()
  if (!trimmed) return undefined
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('\\') ||
    // eslint-disable-next-line no-control-regex
    /[\x00-\x1f\x7f]/.test(trimmed)
  ) {
    return undefined
  }
  return trimmed === '/login' ? undefined : trimmed
}
