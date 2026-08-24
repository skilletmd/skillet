// Kit API client for web settings + subscribe UI.
//
// Registry routes:
//   GET    /api/v1/kits/mine
//   POST   /api/v1/kits
//   PATCH  /api/v1/kits/:kitId
//   GET    /api/v1/kits/:kitId
//   POST   /api/v1/kits/:kitId/skills
//   DELETE /api/v1/kits/:kitId/skills/:author/:slug
//   POST   /api/v1/kits/:kitId/subscribe
//   DELETE /api/v1/kits/:kitId/subscribe
//   GET    /api/v1/authors/:author/kit
//   POST   /api/v1/authors/:author/subscribe
//   DELETE /api/v1/authors/:author/subscribe

import { REGISTRY_API } from './registry-prefix'

export type KitVisibility = 'private' | 'public'

export interface KitSkillEntry {
  skill_id: string
  pinned_hash: string | null
  current_hash: string | null
  added_at: number
  /** Skill metadata, joined server-side for read surfaces (public kit page). */
  description?: string | null
  visibility?: 'private' | 'public'
  install_count?: number
  /** Taxonomy category — drives the cover hue (matches Browse/detail). */
  category?: string | null
  /** Skill author's display name + avatar, joined for the kit-page rows. */
  author_name?: string | null
  author_avatar_url?: string | null
}

export interface KitPayload {
  id: string
  owner: string
  name: string
  /** URL slug, unique per owner. Permalink is `/kits/{owner}/{slug}`. */
  slug: string
  description: string | null
  visibility: KitVisibility
  /** Owner toggle: hide this kit from the owner's public profile. */
  profile_hidden?: boolean
  created_at: number
  /** Unix seconds of the most recent publish among the kit's skills, or null. */
  last_updated?: number | null
  /** 'owned' (default) or 'linked' (mirrors a GitHub repo). */
  source_type?: 'owned' | 'linked'
  /** 'manual' (a real curated/linked kit) or 'saved' (the auto Liked-Songs kit). */
  kind?: 'manual' | 'saved'
  /** Present on linked kits: the repo this kit mirrors. */
  source?: {
    repo: string
    ref: string | null
    path: string | null
    last_synced_sha: string | null
  } | null
  /** Latest PUBLISHED version — a bare 1-indexed integer (0 = unpublished draft). */
  version?: number
  /** Human-facing "major.minor" of the latest published version (e.g. "2.3"); "0" if none. */
  version_label?: string
  /** True when the draft's skill set isn't yet captured in a published version. */
  has_unpublished_changes?: boolean
  /** Skill changes in the draft vs the latest published version. Kit settings
   *  (name/description/visibility) save live and are never "unpublished". */
  unpublished_diff?: {
    added: string[]
    removed: string[]
  }
  /** Approx token weight summed over the kit's member versions (cross-vendor
   *  estimate). Absent when no member carries token data. */
  kit_token_count?: number
  /** Approx always-on cost summed over member versions (name + trigger held in
   *  context per skill). Absent when no member carries token data. */
  kit_token_ambient?: number
  /** Number of subscribers to this kit. */
  subscriber_count?: number
  /** Subscribers to this kit for the facepile, the viewer's follows ranked first. */
  subscribed_by_you?: Array<{ handle: string; name: string | null; avatar_url: string | null }>

  subscribed_by_you_count?: number
  skills: KitSkillEntry[]
  subscribed?: boolean
  /**
   * The viewer's per-kit update-trust preference for this subscription:
   * 'auto' = apply updates silently, 'gate' = review each, null = use the
   * client default. Only meaningful when `subscribed` is true.
   */
  subscription_trust_mode?: 'auto' | 'gate' | null
}

/** One entry in a kit's numbered changelog. */
export interface KitVersionEntry {
  version: number
  /** Human-facing "major.minor" (e.g. "2.3"). */
  version_label?: string
  summary: string | null
  editor: string | null
  /** Unix epoch seconds. */
  created_at: number
  skill_count: number
  /** Skill refs ("owner/slug") added vs the previous version. */
  added?: string[]
  /** Skill refs ("owner/slug") removed vs the previous version. */
  removed?: string[]
}

export type KitVersionsResult =
  | { kind: 'ok'; versions: KitVersionEntry[] }
  | { kind: 'unauthorized' }
  | { kind: 'not_found' }
  | { kind: 'error'; status?: number }

/** A kit surfaced by "subscribers also added" — carries just what a sidebar
 *  KitCard needs to render its cover and link. */
export interface RelatedKitEntry {
  id: string
  owner: string
  slug: string
  name: string
  skill_count: number
  skill_refs: string[]
  skill_categories: (string | null)[]
  subscriber_count: number
}

export type RelatedKitsResult =
  | { kind: 'ok'; kits: RelatedKitEntry[] }
  | { kind: 'unauthorized' }
  | { kind: 'not_found' }
  | { kind: 'error'; status?: number }

export interface AuthorKitPayload {
  kind: 'author'
  ref: string
  owner: string
  name: string
  description: string
  visibility: 'public'
  skills: KitSkillEntry[]
  avatar_url: string | null
  /** Owner is a team/org — cover + byline avatar use the monogram, not a face. */
  is_team?: boolean
  subscribed?: boolean
  /** True for the viewer's own author-kit (their published skills). */
  self?: boolean
  /** People subscribed to this author-kit. */
  subscriber_count?: number
  /** Unix seconds of the most recent public publish, or null if none. */
  last_updated?: number | null
}

export interface MineKitsPayload {
  owned: KitPayload[]
  member: KitPayload[]
  subscribed: KitPayload[]
  author_kits: AuthorKitPayload[]
  /** Teams the viewer administers, for labeling per-team sections. Owned kits
   *  whose `owner` matches a slug here are that team's kits (Saved + custom). */
  teams?: Array<{ slug: string; name: string }>
}

export type ListMineResult =
  | { kind: 'ok'; data: MineKitsPayload }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'error'; status?: number }

export type KitResult =
  | { kind: 'ok'; kit: KitPayload }
  | { kind: 'unauthorized' }
  | { kind: 'not_found' }
  | { kind: 'error'; status?: number }

export type CreateKitResult =
  | { kind: 'ok'; kit: KitPayload }
  | { kind: 'unauthorized' }
  | { kind: 'invalid'; code: string }
  | { kind: 'error'; status?: number }

export type MutateKitResult =
  | { kind: 'ok'; kit: KitPayload }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden' }
  | { kind: 'not_found' }
  | { kind: 'error'; status?: number }

export type SubscribeResult =
  | { kind: 'ok' }
  | { kind: 'unauthorized' }
  | { kind: 'not_found' }
  | { kind: 'conflict' }
  | { kind: 'forbidden' }
  | { kind: 'error'; status?: number }

export type AuthorKitResult =
  | { kind: 'ok'; kit: AuthorKitPayload }
  | { kind: 'not_found' }
  | { kind: 'error'; status?: number }

async function parseJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null)
}

export async function listMineKitsRequest(
  registryUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ListMineResult> {
  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/kits/mine`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  })
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 403) return { kind: 'forbidden' }
  if (!res.ok) return { kind: 'error', status: res.status }
  const data = (await parseJson(res)) as MineKitsPayload
  return { kind: 'ok', data }
}

export async function getKitRequest(
  registryUrl: string,
  token: string | null,
  kitId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KitResult> {
  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/kits/${encodeURIComponent(kitId)}`, {
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 404) return { kind: 'not_found' }
  if (!res.ok) return { kind: 'error', status: res.status }
  const kit = (await parseJson(res)) as KitPayload
  return { kind: 'ok', kit }
}

/** Resolve a kit by its `/kits/{owner}/{slug}` permalink. The registry follows
 *  rename aliases, so the returned kit's `slug` may differ from the requested
 *  one — the caller should canonical-redirect when it does. */
export async function getKitByHandleRequest(
  registryUrl: string,
  token: string | null,
  owner: string,
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KitResult> {
  const res = await fetchImpl(
    `${registryUrl}${REGISTRY_API}/kits/by-handle/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}`,
    {
      headers: {
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    },
  )
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 404) return { kind: 'not_found' }
  if (!res.ok) return { kind: 'error', status: res.status }
  const kit = (await parseJson(res)) as KitPayload
  return { kind: 'ok', kit }
}

export async function getKitVersionsRequest(
  registryUrl: string,
  token: string | null,
  kitId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KitVersionsResult> {
  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/kits/${encodeURIComponent(kitId)}/versions`, {
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 404) return { kind: 'not_found' }
  if (!res.ok) return { kind: 'error', status: res.status }
  const payload = (await parseJson(res)) as { versions?: KitVersionEntry[] }
  return { kind: 'ok', versions: payload.versions ?? [] }
}

export async function getRelatedKitsRequest(
  registryUrl: string,
  token: string | null,
  kitId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RelatedKitsResult> {
  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/kits/${encodeURIComponent(kitId)}/related`, {
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 404) return { kind: 'not_found' }
  if (!res.ok) return { kind: 'error', status: res.status }
  const payload = (await parseJson(res)) as { kits?: RelatedKitEntry[] }
  return { kind: 'ok', kits: payload.kits ?? [] }
}

export async function createKitRequest(
  registryUrl: string,
  token: string,
  body: { name: string; description?: string; visibility?: KitVisibility },
  fetchImpl: typeof fetch = fetch,
): Promise<CreateKitResult> {
  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/kits`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 400) {
    const payload = (await parseJson(res)) as { error?: string }
    return { kind: 'invalid', code: payload.error ?? 'invalid' }
  }
  if (!res.ok) return { kind: 'error', status: res.status }
  const kit = (await parseJson(res)) as KitPayload
  return { kind: 'ok', kit }
}

export async function patchKitRequest(
  registryUrl: string,
  token: string,
  kitId: string,
  body: { name?: string; description?: string | null; visibility?: KitVisibility },
  fetchImpl: typeof fetch = fetch,
): Promise<MutateKitResult> {
  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/kits/${encodeURIComponent(kitId)}`, {
    method: 'PATCH',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 403) return { kind: 'forbidden' }
  if (res.status === 404) return { kind: 'not_found' }
  if (!res.ok) return { kind: 'error', status: res.status }
  const kit = (await parseJson(res)) as KitPayload
  return { kind: 'ok', kit }
}

export async function addSkillToKitRequest(
  registryUrl: string,
  token: string,
  kitId: string,
  author: string,
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MutateKitResult> {
  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/kits/${encodeURIComponent(kitId)}/skills`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ author, slug }),
  })
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 403) return { kind: 'forbidden' }
  if (res.status === 404) return { kind: 'not_found' }
  if (!res.ok) return { kind: 'error', status: res.status }
  const kit = (await parseJson(res)) as KitPayload
  return { kind: 'ok', kit }
}

export async function removeSkillFromKitRequest(
  registryUrl: string,
  token: string,
  kitId: string,
  author: string,
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<MutateKitResult> {
  const res = await fetchImpl(
    `${registryUrl}${REGISTRY_API}/kits/${encodeURIComponent(kitId)}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}`,
    {
      method: 'DELETE',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    },
  )
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 403) return { kind: 'forbidden' }
  if (res.status === 404) return { kind: 'not_found' }
  if (!res.ok) return { kind: 'error', status: res.status }
  const kit = (await parseJson(res)) as KitPayload
  return { kind: 'ok', kit }
}

export async function getAuthorKitRequest(
  registryUrl: string,
  token: string | null,
  author: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthorKitResult> {
  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/authors/${encodeURIComponent(author)}/kit`, {
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  })
  if (res.status === 404) return { kind: 'not_found' }
  if (!res.ok) return { kind: 'error', status: res.status }
  const kit = (await parseJson(res)) as AuthorKitPayload
  return { kind: 'ok', kit }
}

export async function subscribeKitRequest(
  registryUrl: string,
  token: string,
  kitId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubscribeResult> {
  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/kits/${encodeURIComponent(kitId)}/subscribe`, {
    method: 'POST',
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  })
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 403) return { kind: 'forbidden' }
  if (res.status === 404) return { kind: 'not_found' }
  if (res.status === 409) return { kind: 'conflict' }
  if (!res.ok) return { kind: 'error', status: res.status }
  return { kind: 'ok' }
}

export async function unsubscribeKitRequest(
  registryUrl: string,
  token: string,
  kitId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubscribeResult> {
  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/kits/${encodeURIComponent(kitId)}/subscribe`, {
    method: 'DELETE',
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
  })
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 404) return { kind: 'not_found' }
  if (!res.ok) return { kind: 'error', status: res.status }
  return { kind: 'ok' }
}

export async function subscribeAuthorRequest(
  registryUrl: string,
  token: string,
  author: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubscribeResult> {
  const res = await fetchImpl(
    `${registryUrl}${REGISTRY_API}/authors/${encodeURIComponent(author)}/subscribe`,
    {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    },
  )
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 404) return { kind: 'not_found' }
  if (res.status === 409) return { kind: 'conflict' }
  if (!res.ok) return { kind: 'error', status: res.status }
  return { kind: 'ok' }
}

export async function unsubscribeAuthorRequest(
  registryUrl: string,
  token: string,
  author: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubscribeResult> {
  const res = await fetchImpl(
    `${registryUrl}${REGISTRY_API}/authors/${encodeURIComponent(author)}/subscribe`,
    {
      method: 'DELETE',
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    },
  )
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 404) return { kind: 'not_found' }
  if (!res.ok) return { kind: 'error', status: res.status }
  return { kind: 'ok' }
}

/**
 * Loose, display-only split of a `@author/slug` kit ref into its parts, or
 * `null` when it doesn't look like one. Named `parseKitSkillRef` (not
 * `parseSkillRef`) so it can't be confused with core's strict, throwing
 * `parseSkillRef` — same name, divergent behavior. Intentionally lenient: this
 * only feeds UI, never a URL/path sink, so it does no grammar validation.
 */
export function parseKitSkillRef(refName: string): { author: string; slug: string } | null {
  const match = refName.match(/^@([^/]+)\/([^/]+)$/)
  if (!match) return null
  return { author: match[1], slug: match[2] }
}
