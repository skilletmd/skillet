// Org (team) API client for the team-settings UI (epic step 4).
//
// Talks to the registry org routes (packages/registry/src/routes/orgs.ts):
//   POST /api/v1/orgs                    — create org (caller becomes owner)
//   POST /api/v1/orgs/:slug/invites      — invite by handle or email (+role)
//   GET  /api/v1/orgs/:slug/members      — list accepted + pending members
//
// All three are session-gated (Bearer). On the web we hold the registry
// `skillet_s_` session token in an httpOnly cookie, so these calls run on
// the server (route handlers / server actions) where the cookie is readable —
// never in the browser. This module is the client-safe core: types, the role
// constant, and the pure `*Request` functions (injectable fetch) so it is fully
// unit-testable. The cookie-backed server wrappers live in `orgs-server.ts`
// (which imports next/headers and must not enter a client bundle).

import { REGISTRY_API } from './registry-prefix'

/** Roles a member can be invited as. `owner` is reserved for the creator. */
export const INVITABLE_ROLES = ['member', 'admin'] as const
export type InvitableRole = (typeof INVITABLE_ROLES)[number]
export type MemberRole = 'owner' | InvitableRole

export interface OrgRef {
  id: string
  slug: string
  name: string
}

export interface OrgMember {
  user_id: string
  handle: string | null
  role: MemberRole
  invited_at: number
  accepted_at: number | null
}

export interface PendingInvite {
  invite_id: string
  handle: string | null
  email: string | null
  role: MemberRole
  invited_at: number
}

export interface OrgMembers {
  org: OrgRef
  members: OrgMember[]
  pending: PendingInvite[]
}

export type CreateOrgResult =
  | { kind: 'ok'; org: OrgRef }
  | { kind: 'invalid'; code: string }
  | { kind: 'conflict' } // slug already taken
  | { kind: 'unauthorized' }
  | { kind: 'error'; status?: number }

export type InviteResult =
  | { kind: 'added'; memberId: string } // existing user joined immediately
  | { kind: 'invited'; inviteId: string } // pending invite created
  | { kind: 'invalid'; code: string }
  | { kind: 'conflict'; code: string } // already_member / already_invited
  | { kind: 'forbidden' } // not owner/admin
  | { kind: 'not_found' } // org missing
  | { kind: 'unauthorized' }
  | { kind: 'error'; status?: number }

export type MembersResult =
  | { kind: 'ok'; data: OrgMembers }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  | { kind: 'error'; status?: number }

export interface MyOrgEntry {
  slug: string
  name: string
  role: MemberRole
}

export type ListMyOrgsResult =
  | { kind: 'ok'; orgs: MyOrgEntry[] }
  | { kind: 'unauthorized' }
  | { kind: 'error'; status?: number }

/**
 * Owner/admin are the org's managers: they invite, edit the team profile, and
 * publish/edit skills & kits. Plain members can view private team work and
 * propose, but never manage. Single source for the "Manage team" button and the
 * team's kit/skill Edit affordances so they can't drift apart. Any registry
 * hiccup (result not `ok`) → false; never grant manage on uncertainty.
 */
export function viewerManagesOrg(orgs: ListMyOrgsResult, slug: string): boolean {
  return (
    orgs.kind === 'ok' &&
    orgs.orgs.some((o) => o.slug === slug && (o.role === 'owner' || o.role === 'admin'))
  )
}

/**
 * The viewer's role in the org with this slug, or null if they don't belong (or
 * the orgs read failed). Used to confirm membership in the UI ("You're a member
 * of this team") when the viewer isn't a manager and so sees no controls.
 */
export function viewerOrgRole(orgs: ListMyOrgsResult, slug: string): MemberRole | null {
  if (orgs.kind !== 'ok') return null
  return orgs.orgs.find((o) => o.slug === slug)?.role ?? null
}

/** A pending invite addressed to the viewer (their reverse-lookup view). */
export interface MyInviteEntry {
  invite_id: string
  org_slug: string
  org_name: string
  role: MemberRole
  invited_at: number
  invited_by_handle: string | null
}

export type ListMyInvitesResult =
  | { kind: 'ok'; invites: MyInviteEntry[] }
  | { kind: 'unauthorized' }
  | { kind: 'error'; status?: number }

export interface OrgSkillSummary {
  author: string
  slug: string
  skill_id: string
  description: string | null
  latest_hash: string | null
  visibility?: 'private' | 'public'
}

export type ListOrgSkillsResult =
  | { kind: 'ok'; org_slug: string; skills: OrgSkillSummary[] }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  | { kind: 'error'; status?: number }

async function errorCode(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body?.error ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

function authHeaders(token: string, withBody = false): HeadersInit {
  const h: Record<string, string> = {
    accept: 'application/json',
    authorization: `Bearer ${token}`,
  }
  if (withBody) h['content-type'] = 'application/json'
  return h
}

export async function createOrgRequest(
  base: string,
  token: string,
  body: { slug: string; name: string },
  fetchImpl: typeof fetch = fetch,
): Promise<CreateOrgResult> {
  if (!base || !token) return { kind: 'unauthorized' }
  let res: Response
  try {
    res = await fetchImpl(`${base}${REGISTRY_API}/orgs`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    return { kind: 'error' }
  }
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 409) return { kind: 'conflict' }
  if (res.status === 400) return { kind: 'invalid', code: await errorCode(res) }
  if (!res.ok) return { kind: 'error', status: res.status }
  try {
    const data = (await res.json()) as { org_id: string; slug: string; name: string }
    return { kind: 'ok', org: { id: data.org_id, slug: data.slug, name: data.name } }
  } catch {
    return { kind: 'error', status: res.status }
  }
}

export async function inviteMemberRequest(
  base: string,
  token: string,
  slug: string,
  body: { handle?: string; email?: string; role: InvitableRole },
  fetchImpl: typeof fetch = fetch,
): Promise<InviteResult> {
  if (!base || !token) return { kind: 'unauthorized' }
  let res: Response
  try {
    res = await fetchImpl(`${base}${REGISTRY_API}/orgs/${encodeURIComponent(slug)}/invites`, {
      method: 'POST',
      headers: authHeaders(token, true),
      body: JSON.stringify(body),
      cache: 'no-store',
    })
  } catch {
    return { kind: 'error' }
  }
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 403) return { kind: 'forbidden' }
  if (res.status === 404) return { kind: 'not_found' }
  if (res.status === 409) return { kind: 'conflict', code: await errorCode(res) }
  if (res.status === 400) return { kind: 'invalid', code: await errorCode(res) }
  if (!res.ok) return { kind: 'error', status: res.status }
  try {
    const data = (await res.json()) as {
      status: string
      member_id?: string
      invite_id?: string
    }
    if (data.status === 'added' && data.member_id) {
      return { kind: 'added', memberId: data.member_id }
    }
    if (data.status === 'invited' && data.invite_id) {
      return { kind: 'invited', inviteId: data.invite_id }
    }
    return { kind: 'error', status: res.status }
  } catch {
    return { kind: 'error', status: res.status }
  }
}

export async function listMembersRequest(
  base: string,
  token: string,
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MembersResult> {
  if (!base || !token) return { kind: 'unauthorized' }
  let res: Response
  try {
    res = await fetchImpl(`${base}${REGISTRY_API}/orgs/${encodeURIComponent(slug)}/members`, {
      headers: authHeaders(token),
      cache: 'no-store',
    })
  } catch {
    return { kind: 'error' }
  }
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 403) return { kind: 'forbidden' }
  if (res.status === 404) return { kind: 'not_found' }
  if (!res.ok) return { kind: 'error', status: res.status }
  try {
    const data = (await res.json()) as OrgMembers
    return { kind: 'ok', data }
  } catch {
    return { kind: 'error', status: res.status }
  }
}

export async function listMyOrgsRequest(
  base: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ListMyOrgsResult> {
  if (!base || !token) return { kind: 'unauthorized' }
  let res: Response
  try {
    res = await fetchImpl(`${base}${REGISTRY_API}/orgs`, {
      headers: authHeaders(token),
      cache: 'no-store',
    })
  } catch {
    return { kind: 'error' }
  }
  if (res.status === 401) return { kind: 'unauthorized' }
  if (!res.ok) return { kind: 'error', status: res.status }
  try {
    const data = (await res.json()) as { orgs?: MyOrgEntry[] }
    return { kind: 'ok', orgs: data.orgs ?? [] }
  } catch {
    return { kind: 'error', status: res.status }
  }
}

export async function listMyInvitesRequest(
  base: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ListMyInvitesResult> {
  if (!base || !token) return { kind: 'unauthorized' }
  let res: Response
  try {
    res = await fetchImpl(`${base}${REGISTRY_API}/orgs/invites`, {
      headers: authHeaders(token),
      cache: 'no-store',
    })
  } catch {
    return { kind: 'error' }
  }
  if (res.status === 401) return { kind: 'unauthorized' }
  if (!res.ok) return { kind: 'error', status: res.status }
  try {
    const data = (await res.json()) as { invites?: MyInviteEntry[] }
    return { kind: 'ok', invites: data.invites ?? [] }
  } catch {
    return { kind: 'error', status: res.status }
  }
}

export async function listOrgSkillsRequest(
  base: string,
  token: string,
  orgSlug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ListOrgSkillsResult> {
  if (!base || !token) return { kind: 'unauthorized' }
  let res: Response
  try {
    res = await fetchImpl(`${base}${REGISTRY_API}/orgs/${encodeURIComponent(orgSlug)}/skills`, {
      headers: authHeaders(token),
      cache: 'no-store',
    })
  } catch {
    return { kind: 'error' }
  }
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 403) return { kind: 'forbidden' }
  if (res.status === 404) return { kind: 'not_found' }
  if (!res.ok) return { kind: 'error', status: res.status }
  try {
    const data = (await res.json()) as { org_slug?: string; skills?: OrgSkillSummary[] }
    return {
      kind: 'ok',
      org_slug: data.org_slug ?? orgSlug,
      skills: data.skills ?? [],
    }
  } catch {
    return { kind: 'error', status: res.status }
  }
}
