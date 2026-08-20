/**
 * OAuth sign-in provider copy and ordering for the consumer auth surfaces.
 */
import {
  readAuthGithubCredentials,
  readAuthGoogleCredentials,
  readAuthTwitterCredentials,
} from '@/lib/oauth-env'

export type AuthProvider = 'google' | 'github' | 'twitter'

/** Button label per provider. Order is set by configuredAuthProviders(). */
export const PROVIDER_LABEL: Record<AuthProvider, string> = {
  google: 'Continue with Google',
  github: 'Continue with GitHub',
  twitter: 'Continue with X',
}

/** Every provider with credentials configured in the current environment.
 *  The full linkable set; configuredLoginProviders() narrows it to the sign-in
 *  surface. (/settings reads the per-provider credential helpers directly.) */
export function configuredAuthProviders(): AuthProvider[] {
  const providers: AuthProvider[] = []
  if (readAuthGoogleCredentials()) providers.push('google')
  if (readAuthGithubCredentials()) providers.push('github')
  if (readAuthTwitterCredentials()) providers.push('twitter')
  return providers
}

/** Providers offered as a way to sign in / create an account. We deliberately
 *  keep this to Google (plus the email magic link, handled separately) — GitHub
 *  and X stay link-only on /settings, not sign-in surfaces. */
export function configuredLoginProviders(): AuthProvider[] {
  return configuredAuthProviders().filter((p) => p === 'google')
}
