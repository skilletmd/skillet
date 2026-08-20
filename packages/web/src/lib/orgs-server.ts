// Server-only org wrappers: read the httpOnly session cookie and call
// the registry org API with the Bearer. Imports next/headers, so this module
// must never be pulled into a client bundle — keep client-safe types/constants
// and the pure `*Request` functions in `orgs.ts`.
import { cache } from 'react'
import { cookies } from 'next/headers'
import { readSessionCookie } from './session-cookie'
import { REGISTRY_API } from './registry-prefix'
import {
  createOrgRequest,
  inviteMemberRequest,
  listMembersRequest,
  listMyInvitesRequest,
  listMyOrgsRequest,
  listOrgSkillsRequest,
  type CreateOrgResult,
  type InvitableRole,
  type InviteResult,
  type ListMyInvitesResult,
  type ListMyOrgsResult,
  type ListOrgSkillsResult,
  type MembersResult,
} from './orgs'

function registryBaseUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

async function serverToken(): Promise<string | null> {
  const jar = await cookies()
  return readSessionCookie(jar) ?? null
}

export async function createOrg(body: { slug: string; name: string }): Promise<CreateOrgResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return createOrgRequest(registryBaseUrl(), token, body)
}

export async function inviteMember(
  slug: string,
  body: { handle?: string; email?: string; role: InvitableRole },
): Promise<InviteResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return inviteMemberRequest(registryBaseUrl(), token, slug, body)
}

export async function listOrgMembers(slug: string): Promise<MembersResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return listMembersRequest(registryBaseUrl(), token, slug)
}

// Wrapped in cache() so the several places that need the viewer's orgs in one
// render (e.g. the feed team tabs + the team feed surface) share a single request.
export const listMyOrgs = cache(async (): Promise<ListMyOrgsResult> => {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return listMyOrgsRequest(registryBaseUrl(), token)
})

// Cached like listMyOrgs so a render that needs both the viewer's teams and
// their pending invites (the Teams settings page) shares one request each.
export const listMyInvites = cache(async (): Promise<ListMyInvitesResult> => {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return listMyInvitesRequest(registryBaseUrl(), token)
})

export async function listOrgSkills(orgSlug: string): Promise<ListOrgSkillsResult> {
  const token = await serverToken()
  if (!token) return { kind: 'unauthorized' }
  return listOrgSkillsRequest(registryBaseUrl(), token, orgSlug)
}

/** The team kit ids the viewer has muted — for rendering the Teams-tab toggles.
 *  Any hiccup returns an empty set (default: nothing muted). */
export async function getMutedTeamKitIds(): Promise<Set<string>> {
  const token = await serverToken()
  if (!token) return new Set()
  try {
    const res = await fetch(`${registryBaseUrl()}${REGISTRY_API}/me/muted-team-kits`, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!res.ok) return new Set()
    const data = (await res.json()) as { kit_ids?: string[] }
    return new Set(data.kit_ids ?? [])
  } catch {
    return new Set()
  }
}
