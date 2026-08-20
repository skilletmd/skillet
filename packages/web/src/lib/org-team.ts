// Browser client for the org member-management surfaces.
//
// Three mutating calls layered on the registry org API and its
// additions. All run in the browser and go through the web BFF proxy
// (`/api/registry/...`) so the httpOnly session cookie is attached upstream —
// the same pattern as the proposals client (src/lib/proposals.ts).
//
// The org routes are root-mounted on the registry at `/api/v1/orgs/...` (they
// hardcode the full path rather than sitting under the version-prefix mount),
// so the proxy suffix is `api/v1/orgs/...`, NOT the bare `v1/...` the skills
// endpoints use.
//
// The FE Engineer owns the team page scaffold and the member-list render;
// this module is additive — the row-action components and the accept page call
// these helpers. Keep new shared helpers append-only here so the two lanes do
// not collide.

import { registryAuthApi } from './registry-proxy'

export type OrgRole = 'owner' | 'admin' | 'member'

/** Roles assignable through the role picker — 'owner' is never assignable. */
export const ASSIGNABLE_ROLES: ReadonlyArray<Exclude<OrgRole, 'owner'>> = ['admin', 'member']

export interface OrgMember {
  user_id: string
  handle: string | null
  role: OrgRole
}

export interface PendingInvite {
  invite_id: string
  handle: string | null
  email: string | null
  role: OrgRole
}

/** Discriminated outcome shared by every mutating call below. */
export type TeamActionResult<T = void> =
  | { kind: 'ok'; data: T }
  /** Signed out — the caller should route to /login. */
  | { kind: 'unauthorized' }
  /** Signed in but not allowed (e.g. a member trying to change a role). */
  | { kind: 'forbidden' }
  /** The member / invite no longer exists. */
  | { kind: 'notfound' }
  /** Any other non-OK response or a network failure. `error` is the server code if known. */
  | { kind: 'error'; status?: number; error?: string }

/**
 * Base path for the org API through the web BFF. In the browser we always go
 * through the proxy so the session cookie is attached; there is no meaningful
 * direct-to-registry path for these mutations (they are user-session-gated), so
 * server-side callers are unsupported and get a relative path that only works
 * in the browser.
 */
function orgApiBase(slug: string): string {
  return registryAuthApi(`orgs/${encodeURIComponent(slug)}`)
}

async function mapError<T>(res: Response): Promise<TeamActionResult<T>> {
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 403) return { kind: 'forbidden' }
  if (res.status === 404) return { kind: 'notfound' }
  let error: string | undefined
  try {
    const body = (await res.json()) as { error?: string }
    error = typeof body?.error === 'string' ? body.error : undefined
  } catch {
    // non-JSON body — leave error undefined
  }
  return { kind: 'error', status: res.status, error }
}

/**
 * Remove an accepted member or revoke a pending invite. `memberOrInviteId` is
 * the member's `user_id` for accepted rows and the `invite_id` for pending
 * rows — the registry resolves whichever it is. Owner/admin only.
 */
export async function removeMember(
  slug: string,
  memberOrInviteId: string,
  init?: { signal?: AbortSignal },
): Promise<TeamActionResult<{ status: 'removed' | 'revoked' }>> {
  let res: Response
  try {
    res = await fetch(`${orgApiBase(slug)}/members/${encodeURIComponent(memberOrInviteId)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal: init?.signal,
    })
  } catch {
    return { kind: 'error' }
  }
  if (!res.ok) return mapError(res)
  try {
    const data = (await res.json()) as { status: 'removed' | 'revoked' }
    return { kind: 'ok', data }
  } catch {
    return { kind: 'ok', data: { status: 'removed' } }
  }
}

/** Change an accepted member's role. Owner-only; 'owner' is not assignable. */
export async function changeMemberRole(
  slug: string,
  userId: string,
  role: Exclude<OrgRole, 'owner'>,
  init?: { signal?: AbortSignal },
): Promise<TeamActionResult<{ role: OrgRole }>> {
  let res: Response
  try {
    res = await fetch(`${orgApiBase(slug)}/members/${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
      signal: init?.signal,
    })
  } catch {
    return { kind: 'error' }
  }
  if (!res.ok) return mapError(res)
  try {
    const data = (await res.json()) as { role: OrgRole }
    return { kind: 'ok', data }
  } catch {
    return { kind: 'ok', data: { role } }
  }
}

export interface AcceptedOrg {
  id: string
  slug: string
  name: string
}

/**
 * Redeem a pending invite for the signed-in caller. The registry matches the
 * caller against the invite (session handle, or an email on a linked identity)
 * and returns the org so the page can route in.
 */
export async function acceptInvite(
  slug: string,
  inviteId: string,
  init?: { signal?: AbortSignal },
): Promise<TeamActionResult<{ org: AcceptedOrg; role: OrgRole }>> {
  let res: Response
  try {
    res = await fetch(`${orgApiBase(slug)}/invites/${encodeURIComponent(inviteId)}/accept`, {
      method: 'POST',
      credentials: 'include',
      headers: { accept: 'application/json' },
      signal: init?.signal,
    })
  } catch {
    return { kind: 'error' }
  }
  if (!res.ok) return mapError(res)
  try {
    const data = (await res.json()) as { org: AcceptedOrg; role: OrgRole }
    return { kind: 'ok', data }
  } catch {
    return { kind: 'error', status: res.status }
  }
}

/** A viewer may change roles only if they are the owner. */
export function canChangeRoles(viewerRole: OrgRole | null): boolean {
  return viewerRole === 'owner'
}

/** A viewer may remove members / revoke invites if they are owner or admin. */
export function canRemoveMembers(viewerRole: OrgRole | null): boolean {
  return viewerRole === 'owner' || viewerRole === 'admin'
}
