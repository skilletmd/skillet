import 'server-only'

import { webInternalSecret } from './registry-session'
import { REGISTRY_API } from './registry-prefix'
import { signWebInternalHeaders } from './web-internal-sign'
import type { OwnedRepo } from './github-repos'

function registryBaseUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

export interface ConnectedRepo {
  id: string
  owner: string
  repo: string
  full: string
  url: string
  default_branch: string | null
  last_synced_at: number | null
  status: string
  created_at: number
  /** The Skillet handle the synced skills/kit publish under (you or a team) —
   *  NOT the GitHub repo owner. Profile links must use this. */
  author?: string
  /** The dirs currently synced (null = whole repo). The import wizard pre-checks
   *  these on reconfigure so re-syncing doesn't drop the rest. */
  selected_dirs?: string[] | null
  /** How many of the author's live skills are mirrored from this repo. */
  skill_count?: number
  /** The synced skills (slug + description + category for the cover). */
  skills?: Array<{ slug: string; description: string | null; category: string | null }>
  /** The linked kit this repo publishes into (when it has >1 skill). */
  kit?: { id: string; name: string; slug: string | null } | null
}

export interface SyncSummary {
  added: number
  updated: number
  unchanged: number
  skipped: number
  total: number
  /** Slugs of the skills synced from the repo. */
  skills?: string[]
  /** The linked kit (when the repo has >1 skill). */
  kitId?: string | null
  kitName?: string | null
}

export async function listConnectedRepos(sessionToken: string): Promise<ConnectedRepo[]> {
  const res = await fetch(`${registryBaseUrl()}${REGISTRY_API}/github/repos`, {
    headers: { authorization: `Bearer ${sessionToken}`, accept: 'application/json' },
    cache: 'no-store',
  })
  if (!res.ok) return []
  return ((await res.json()) as { repos?: ConnectedRepo[] }).repos ?? []
}

export interface ConnectResult {
  ok: boolean
  error?: string
  sync?: SyncSummary
}

/**
 * The caller's owned public repos for the connect picker, listed by the registry
 * with its stored read-only token (which never leaves the registry). `connected`
 * is the single "we hold a usable GitHub token" signal — true once the user has
 * signed in with GitHub or completed the one-time minimal-scope connect.
 */
export interface GithubUser {
  login: string
  name: string | null
}

export async function fetchOwnedReposViaRegistry(
  sessionToken: string,
): Promise<{ connected: boolean; repos: OwnedRepo[]; user: GithubUser | null }> {
  const path = `${REGISTRY_API}/github/owned-repos`
  const res = await fetch(`${registryBaseUrl()}${path}`, {
    headers: {
      authorization: `Bearer ${sessionToken}`,
      ...signWebInternalHeaders({ secret: webInternalSecret(), method: 'GET', path, body: {} }),
      accept: 'application/json',
    },
    cache: 'no-store',
  })
  if (!res.ok) return { connected: false, repos: [], user: null }
  const body = (await res.json()) as {
    connected?: boolean
    repos?: OwnedRepo[]
    user?: GithubUser | null
  }
  return { connected: body.connected === true, repos: body.repos ?? [], user: body.user ?? null }
}

/** Persist the read-only token from a one-time minimal-scope connect so the user
 *  is "connected" durably (no per-add re-grant). Best-effort; returns ok. */
export async function storeGithubConnectToken(
  sessionToken: string,
  token: string,
): Promise<boolean> {
  const path = `${REGISTRY_API}/github/connect-token`
  const reqBody = { token }
  const res = await fetch(`${registryBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${sessionToken}`,
      ...signWebInternalHeaders({ secret: webInternalSecret(), method: 'POST', path, body: reqBody }),
      'content-type': 'application/json',
    },
    body: JSON.stringify(reqBody),
  })
  return res.ok
}

export async function connectRepo(input: {
  sessionToken: string
  owner: string
  repo: string
  /** The read-only grant token. Omit to let the registry use the user's stored
   *  token (GitHub-sign-in users, or anyone who connected before). */
  token?: string
  license?: string | null
  /** Sync only these skill dirs (subset). Omit to sync all. */
  dirs?: string[]
  /** Name for the linked kit. */
  kitName?: string
  /** Bundle >1 skill into a kit (default true); false publishes them loose. */
  bundle?: boolean
  /** Publish under a team you admin instead of yourself. */
  publishAs?: string
}): Promise<ConnectResult> {
  const path = `${REGISTRY_API}/github/repos`
  const reqBody = {
    owner: input.owner,
    repo: input.repo,
    ...(input.token ? { token: input.token } : {}),
    license: input.license ?? null,
    ...(input.dirs ? { dirs: input.dirs } : {}),
    ...(input.kitName ? { kitName: input.kitName } : {}),
    ...(input.bundle !== undefined ? { bundle: input.bundle } : {}),
    ...(input.publishAs ? { publishAs: input.publishAs } : {}),
  }
  const res = await fetch(`${registryBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.sessionToken}`,
      ...signWebInternalHeaders({ secret: webInternalSecret(), method: 'POST', path, body: reqBody }),
      'content-type': 'application/json',
    },
    body: JSON.stringify(reqBody),
  })
  const body = (await res.json().catch(() => null)) as {
    message?: string
    error?: string
    sync?: SyncSummary
  } | null
  if (!res.ok) return { ok: false, error: body?.message ?? body?.error ?? `HTTP ${res.status}` }
  return { ok: true, sync: body?.sync }
}

export async function refreshConnectedRepo(
  sessionToken: string,
  id: string,
): Promise<ConnectResult> {
  const res = await fetch(`${registryBaseUrl()}${REGISTRY_API}/github/repos/${id}/refresh`, {
    method: 'POST',
    headers: { authorization: `Bearer ${sessionToken}` },
  })
  const body = (await res.json().catch(() => null)) as {
    sync?: SyncSummary
    message?: string
  } | null
  if (!res.ok) return { ok: false, error: body?.message ?? `HTTP ${res.status}` }
  return { ok: true, sync: body?.sync }
}

export async function disconnectConnectedRepo(sessionToken: string, id: string): Promise<boolean> {
  const res = await fetch(`${registryBaseUrl()}${REGISTRY_API}/github/repos/${id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${sessionToken}` },
  })
  return res.ok
}
