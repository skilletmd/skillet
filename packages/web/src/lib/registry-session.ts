import { randomBytes } from 'node:crypto'
import type { Account, Profile } from 'next-auth'
import { getToken } from 'next-auth/jwt'
import type { NextRequest } from 'next/server'
import { REGISTRY_API } from './registry-prefix'
import { signWebInternalHeaders } from './web-internal-sign'
import { logRegistryDegrade } from './registry-errors'

export interface RegistrySessionMint {
  session_token: string
  user_id: string
  handle: string | null
  email: string | null
  two_factor: boolean
  linked_providers: string[]
  github_linked: boolean
}

export interface RegistryIdentityResult {
  user_id: string
  handle: string | null
  email: string | null
  two_factor: boolean
  linked_providers: string[]
  github_linked: boolean
}

export interface RegistryWhoamiSession {
  token_class: 'session'
  user_id: string
  handle: string | null
  email?: string | null
  two_factor: boolean
  scopes: string[]
  linked_providers?: string[]
  github_linked?: boolean
  brand_claim_eligible?: string[]
}

function registryBaseUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

// Per-process random stand-in used ONLY under the explicit dev-auth gate. In that
// mode the registry verifier accepts on its own dev-auth flag and NEVER checks
// this value (see registry auth/web-internal-sig.ts: no configured secret → open
// iff devAuth), so a random, non-well-known value is safe and can never become a
// shared, forgeable key the way a hardcoded constant could. Computed lazily so a
// real configured deployment never spends the entropy.
let cachedDevSigningPlaceholder: string | undefined
function devSigningPlaceholder(): string {
  return (cachedDevSigningPlaceholder ??= randomBytes(32).toString('hex'))
}

/**
 * The web-BFF HMAC signing secret. Used to sign (not present raw) every internal
 * registry call — see ./web-internal-sign.ts. The registry verifies the signature
 * against this same secret (env `SKILLET_WEB_SIGNING_SECRET`).
 */
export function webInternalSecret(): string {
  const secret = process.env.SKILLET_WEB_SIGNING_SECRET
  if (secret && secret.length > 0) return secret
  // Fail closed. A missing secret must NOT fall back to a well-known constant —
  // anyone who knows it could forge a valid signature and mint a session for any
  // account. Gate the fallback on the explicit dev-auth flag (mirroring the
  // registry verifier), NEVER on NODE_ENV: a staging/preview/self-hosted box with
  // NODE_ENV unset or non-'production' must fail closed too. Even under the flag,
  // return a per-process random — never a shared constant.
  if (process.env.SKILLET_ENABLE_DEV_AUTH === '1') return devSigningPlaceholder()
  throw new Error(
    'SKILLET_WEB_SIGNING_SECRET must be set. Refusing to use a default web-signing secret. ' +
      'For local dev without a configured secret, set SKILLET_ENABLE_DEV_AUTH=1.',
  )
}

/** Build the three x-skillet-web-* signing headers for an internal registry call. */
function webSignHeaders(method: string, path: string, body: unknown): Record<string, string> {
  return signWebInternalHeaders({ secret: webInternalSecret(), method, path, body })
}

type RegistryIdentityInput = {
  provider: 'github' | 'google' | 'twitter'
  providerSubjectId: string
  email?: string | null
  login?: string | null
  twoFactor?: boolean
  emailVerified?: boolean
  displayName?: string | null
  avatarUrl?: string | null
  /** GitHub OAuth access token from sign-in, stored read-only for repo reuse.
   *  GitHub only; the registry ignores it for other providers. Never reaches the
   *  browser — it rides only on this server→registry signed call. */
  providerToken?: string | null
}

function identityBody(input: RegistryIdentityInput): Record<string, unknown> {
  return {
    provider: input.provider,
    provider_subject_id: input.providerSubjectId,
    email: input.email ?? null,
    login: input.login ?? null,
    two_factor: input.twoFactor === true,
    email_verified: input.emailVerified === true,
    display_name: input.displayName ?? null,
    avatar_url: input.avatarUrl ?? null,
    ...(input.providerToken ? { provider_token: input.providerToken } : {}),
  }
}

/** Attach a provider identity to the user behind an existing registry session. */
export async function linkRegistryIdentity(
  sessionToken: string,
  input: RegistryIdentityInput,
): Promise<RegistryIdentityResult> {
  const path = `${REGISTRY_API}/auth/link`
  const body = identityBody(input)
  const res = await fetch(`${registryBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sessionToken}`,
      ...webSignHeaders('POST', path, body),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (res.status === 409) {
    const err = (await res.json().catch(() => ({}))) as { error?: string }
    if (err.error === 'identity_already_linked') {
      throw new Error('identity_already_linked')
    }
    throw new Error('identity_link_conflict')
  }

  if (!res.ok) {
    throw new Error(`registry_identity_link_failed:${res.status}`)
  }

  return (await res.json()) as RegistryIdentityResult
}

/** Unlink a provider identity from the user behind an existing session. The
 *  registry refuses to remove the last sign-in method (returns 409). Returns the
 *  HTTP-ok flag and the registry's error code (for a precise UI message). */
export async function unlinkRegistryIdentity(
  sessionToken: string,
  provider: 'github' | 'twitter' | 'google',
): Promise<{ ok: boolean; error?: string }> {
  const path = `${REGISTRY_API}/auth/link`
  const body = { provider }
  const res = await fetch(`${registryBaseUrl()}${path}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${sessionToken}`,
      ...webSignHeaders('DELETE', path, body),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (res.ok) return { ok: true }
  const err = (await res.json().catch(() => ({}))) as { error?: string }
  return { ok: false, error: err.error }
}

export async function mintRegistryWebSession(
  input: RegistryIdentityInput,
): Promise<RegistrySessionMint> {
  const path = `${REGISTRY_API}/auth/web/session`
  const body = identityBody(input)
  const res = await fetch(`${registryBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      ...webSignHeaders('POST', path, body),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    throw new Error(`registry_session_mint_failed:${res.status}`)
  }

  return (await res.json()) as RegistrySessionMint
}

/**
 * In-flight self-heal re-mints, keyed by fully-qualified identity, so a burst of
 * concurrent requests collapses to ONE upstream mint. A settings page load fires
 * several authenticated requests at once; behind an expired registry session each
 * would independently 401 → re-mint, spawning N session rows and racing N
 * Set-Cookie headers (last one wins, the rest are orphaned). Sharing the in-flight
 * promise means the whole burst mints once and all set the same fresh cookie.
 *
 * The key is `identity + the rejected session token (scope)`. The identity part
 * (incl. `expectedUserId`) means a mint is NEVER shared across accounts; the
 * scope means a burst is shared only among requests that carried the SAME
 * expired cookie — i.e. one browser's page load. Two browsers of the same user
 * present different (or no) cookies, so they never collapse onto one session
 * token (which would let revoking/expiring one silently drop the other).
 *
 * Entries are evicted the moment they settle — this dedupes the burst, it is not
 * a token cache.
 */
const inflightRefresh = new Map<string, Promise<RegistrySessionMint | null>>()

/** Re-issue a registry session for an already-linked identity (NO profile/2FA side
 *  effects) — used by the BFF proxy to self-heal an expired registry session behind
 *  a still-valid web session. Concurrent calls for the same identity + rejected
 *  token share one upstream mint (see {@link inflightRefresh}). `scope` is that
 *  rejected token; pass it so one browser's burst dedupes without merging distinct
 *  browsers. Returns null on any failure so the caller falls back to signing out. */
export function refreshRegistryWebSession(
  identity: {
    provider: string
    providerSubjectId: string
    expectedUserId: string
  },
  scope?: string,
): Promise<RegistrySessionMint | null> {
  // NUL-separated so no field boundary can collide (ids never contain NUL).
  const key = [
    identity.provider,
    identity.providerSubjectId,
    identity.expectedUserId,
    scope ?? '',
  ].join('\u0000')
  const existing = inflightRefresh.get(key)
  if (existing) return existing

  const pending = mintRefreshedSession(identity)
  inflightRefresh.set(key, pending)
  // Evict once settled. mintRefreshedSession never rejects (it resolves null on
  // failure), so a plain finally is enough and can't leave a rejected promise cached.
  void pending.finally(() => {
    // Only clear if still the same entry — a later burst may have replaced it.
    if (inflightRefresh.get(key) === pending) inflightRefresh.delete(key)
  })
  return pending
}

async function mintRefreshedSession(identity: {
  provider: string
  providerSubjectId: string
  expectedUserId: string
}): Promise<RegistrySessionMint | null> {
  try {
    const path = `${REGISTRY_API}/auth/web/session/refresh`
    const body = {
      provider: identity.provider,
      provider_subject_id: identity.providerSubjectId,
      expected_user_id: identity.expectedUserId,
    }
    const res = await fetch(`${registryBaseUrl()}${path}`, {
      method: 'POST',
      headers: {
        ...webSignHeaders('POST', path, body),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    if (!res.ok) {
      logRegistryDegrade(`web session refresh responded ${res.status}`)
      return null
    }
    return (await res.json()) as RegistrySessionMint
  } catch (cause) {
    logRegistryDegrade('web session refresh failed', cause)
    return null
  }
}

/** Read the registry identity stashed in the ENCRYPTED, httpOnly next-auth JWT.
 *  Server-only — never exposed to the browser — and used solely to self-heal an
 *  expired registry session (see refreshRegistryWebSession). Fails closed (null)
 *  if the token can't be read, so a decode problem degrades to "sign out", never
 *  to a security bypass. The expected user id comes from the VERIFIED JWT, never
 *  from a whoami on the just-rejected session token. */
export async function webSessionIdentity(
  request: NextRequest,
): Promise<{ provider: string; providerSubjectId: string; expectedUserId: string } | null> {
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET
  if (!secret) return null
  const secureCookie = process.env.NODE_ENV === 'production'
  const cookieName = secureCookie ? '__Secure-authjs.session-token' : 'authjs.session-token'
  try {
    const token = await getToken({ req: request, secret, salt: cookieName, secureCookie, cookieName })
    const id = token?.registryIdentity as
      | { provider?: string; providerSubjectId?: string }
      | undefined
    const expectedUserId = typeof token?.registryUserId === 'string' ? token.registryUserId : undefined
    return id?.provider && id.providerSubjectId && expectedUserId
      ? { provider: id.provider, providerSubjectId: id.providerSubjectId, expectedUserId }
      : null
  } catch {
    return null
  }
}

export async function fetchRegistryWhoami(
  sessionToken: string,
): Promise<RegistryWhoamiSession | null> {
  try {
    const res = await fetch(`${registryBaseUrl()}${REGISTRY_API}/whoami`, {
      headers: {
        authorization: `Bearer ${sessionToken}`,
        accept: 'application/json',
      },
      cache: 'no-store',
    })
    if (!res.ok) {
      // 401 here is the expected "session no longer valid" signal, not an outage;
      // only a 5xx is a registry fault worth flagging.
      if (res.status >= 500) logRegistryDegrade(`whoami responded ${res.status}`)
      return null
    }
    const body = (await res.json()) as { token_class?: string }
    if (body.token_class !== 'session') return null
    return body as RegistryWhoamiSession
  } catch (cause) {
    logRegistryDegrade('whoami fetch failed', cause)
    return null
  }
}

/**
 * The viewer's own Skillet display name + avatar from their public author page.
 * Used to seed the next-auth session so the rail/nav render the real identity at
 * first paint, with no client fetch and no flash. `avatarUrl` is null when the
 * viewer uses the generated default avatar.
 */
export async function fetchRegistryProfileBasics(
  handle: string,
): Promise<{ name: string | null; avatarUrl: string | null } | null> {
  try {
    const res = await fetch(`${registryBaseUrl()}${REGISTRY_API}/authors/${encodeURIComponent(handle)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) {
      if (res.status !== 404) logRegistryDegrade(`profile basics responded ${res.status}: ${handle}`)
      return null
    }
    const body = (await res.json()) as { name?: string | null; avatar_url?: string | null }
    return { name: body.name ?? null, avatarUrl: body.avatar_url ?? null }
  } catch (cause) {
    logRegistryDegrade(`profile basics fetch failed: ${handle}`, cause)
    return null
  }
}

/**
 * Has this account ever connected a device that finished a sync? Used to route a
 * genuinely-new user into /welcome. Returns `null` when the answer is unknown
 * (fetch failed) so callers can fail safe rather than dumping an established
 * user into onboarding. "Connected" means a device that reported runtimes
 * (`agents_reported_at`), matching the /welcome flow's own definition — a
 * half-paired device that hasn't synced yet does not count.
 */
export async function hasConnectedDevice(sessionToken: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${registryBaseUrl()}${REGISTRY_API}/devices`, {
      headers: { authorization: `Bearer ${sessionToken}`, accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) {
      if (res.status >= 500) logRegistryDegrade(`devices responded ${res.status}`)
      return null
    }
    const body = (await res.json()) as { devices?: Array<{ agents_reported_at?: number | null }> }
    if (!Array.isArray(body.devices)) return null
    return body.devices.some((d) => d.agents_reported_at != null)
  } catch (cause) {
    logRegistryDegrade('connected-device check failed', cause)
    return null
  }
}

export async function revokeRegistrySession(sessionToken: string): Promise<void> {
  try {
    await fetch(`${registryBaseUrl()}${REGISTRY_API}/auth/logout`, {
      method: 'POST',
      headers: { authorization: `Bearer ${sessionToken}` },
    })
  } catch (cause) {
    // Best-effort revoke on sign-out — log but don't block the user signing out.
    logRegistryDegrade('session revoke failed', cause)
  }
}

export function identityFromAuthJs(
  account: Account,
  profile?: Profile,
): {
  provider: 'github' | 'google' | 'twitter'
  providerSubjectId: string
  email?: string | null
  login?: string | null
  twoFactor?: boolean
  emailVerified?: boolean
  displayName?: string | null
  avatarUrl?: string | null
} | null {
  if (
    account.provider !== 'github' &&
    account.provider !== 'google' &&
    account.provider !== 'twitter'
  ) {
    return null
  }
  if (!account.providerAccountId) return null

  const ghProfile = profile as
    | { login?: string; two_factor_authentication?: boolean; name?: string; image?: string }
    | undefined
  const googleProfile = profile as
    | { name?: string; picture?: string; email_verified?: boolean }
    | undefined
  const twitterProfile = profile as
    | {
        data?: {
          name?: string
          username?: string
          profile_image_url?: string
          verified?: boolean
        }
        name?: string
        picture?: string
        image?: string
      }
    | undefined

  const displayName =
    (typeof profile?.name === 'string' && profile.name.trim()) ||
    (account.provider === 'google'
      ? googleProfile?.name?.trim()
      : account.provider === 'twitter'
        ? (twitterProfile?.data?.name?.trim() ?? twitterProfile?.name?.trim())
        : ghProfile?.name?.trim()) ||
    null

  const avatarUrl =
    (typeof profile?.image === 'string' && profile.image) ||
    (typeof (profile as { picture?: string } | undefined)?.picture === 'string'
      ? (profile as { picture: string }).picture
      : null) ||
    ghProfile?.image ||
    googleProfile?.picture ||
    twitterProfile?.data?.profile_image_url ||
    twitterProfile?.picture ||
    twitterProfile?.image ||
    null

  return {
    provider: account.provider,
    providerSubjectId: account.providerAccountId,
    email: typeof account.email === 'string' ? account.email : (profile?.email ?? null),
    login:
      account.provider === 'github'
        ? (ghProfile?.login ?? (typeof account.username === 'string' ? account.username : null))
        : account.provider === 'twitter'
          ? (twitterProfile?.data?.username ??
            (typeof account.username === 'string' ? account.username : null))
          : null,
    twoFactor:
      account.provider === 'github' ? ghProfile?.two_factor_authentication === true : false,
    emailVerified:
      account.provider === 'github'
        ? true
        : account.provider === 'google'
          ? googleProfile?.email_verified === true
          : account.provider === 'twitter'
            ? typeof account.email === 'string' && account.email.length > 0
            : false,
    displayName,
    avatarUrl,
  }
}
