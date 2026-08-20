'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { readSessionCookie } from '@/lib/session-cookie'
import { GH_REPO_TOKEN_COOKIE } from '@/app/api/github/connect/callback/route'
import { connectRepo, refreshConnectedRepo, disconnectConnectedRepo } from '@/lib/connected-repos'

export interface ConnectState {
  error?: string
  ok?: boolean
  message?: string
  /** Slugs synced, for the result list. */
  skills?: string[]
  kitId?: string | null
  kitName?: string | null
}

/** Parse "owner/repo" or a github URL into { owner, repo }. */
function parseRepo(input: string): { owner: string; repo: string } | null {
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
  const m = cleaned.match(/^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/)
  return m ? { owner: m[1]!, repo: m[2]! } : null
}

export async function connectRepoAction(
  _prev: ConnectState,
  formData: FormData,
): Promise<ConnectState> {
  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  if (!sessionToken) return { error: 'Sign in first.' }
  // Token is optional: a fresh grant cookie takes precedence, else the registry
  // uses the user's stored read-only token. If neither exists the registry
  // returns a clear "Connect GitHub first" error.
  const repoToken = jar.get(GH_REPO_TOKEN_COOKIE)?.value

  const parsed = parseRepo(String(formData.get('repo') ?? ''))
  if (!parsed) return { error: 'Enter a repo as owner/repo.' }

  const res = await connectRepo({
    sessionToken,
    owner: parsed.owner,
    repo: parsed.repo,
    ...(repoToken ? { token: repoToken } : {}),
  })
  if (!res.ok) return { error: res.error ?? 'Could not connect that repo.' }
  revalidatePath('/settings/github')
  const s = res.sync
  const count = s?.skills?.length ?? (s ? s.added + s.updated : 0)
  return {
    ok: true,
    message: `Synced ${count} skill${count === 1 ? '' : 's'}.`,
    skills: s?.skills ?? [],
    kitId: s?.kitId ?? null,
    kitName: s?.kitName ?? null,
  }
}

/**
 * Sync a specific owner/repo + chosen skill dirs — called from the import wizard
 * after discovery, when the user opts to keep an owned repo in sync. Needs GitHub
 * connected (repo token cookie) for ownership + sync.
 */
export async function syncFromWizard(input: {
  owner: string
  repo: string
  /** Locked subset of skill dirs. Omit for a coupled repo so sync classifies it
   *  as one unified skill (the registry treats a subset as kit mode). */
  dirs?: string[]
  kitName?: string
  /** Bundle >1 skill into a kit (default true); false publishes them loose. */
  bundle?: boolean
  /** Publish under a team you admin instead of yourself. */
  publishAs?: string
}): Promise<ConnectState> {
  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  if (!sessionToken) return { error: 'Sign in first.' }
  // Optional: fresh grant cookie → else the registry's stored token.
  const repoToken = jar.get(GH_REPO_TOKEN_COOKIE)?.value

  const res = await connectRepo({
    sessionToken,
    owner: input.owner,
    repo: input.repo,
    ...(repoToken ? { token: repoToken } : {}),
    ...(input.dirs ? { dirs: input.dirs } : {}),
    ...(input.kitName ? { kitName: input.kitName } : {}),
    ...(input.bundle !== undefined ? { bundle: input.bundle } : {}),
    ...(input.publishAs ? { publishAs: input.publishAs } : {}),
  })
  if (!res.ok) return { error: res.error ?? 'Could not set up sync.' }
  revalidatePath('/settings/github')
  const s = res.sync
  const count = s?.skills?.length ?? 0
  return {
    ok: true,
    message: `Now syncing ${count} skill${count === 1 ? '' : 's'} from ${input.owner}/${input.repo}.`,
    skills: s?.skills ?? [],
    kitId: s?.kitId ?? null,
    kitName: s?.kitName ?? null,
  }
}

export async function refreshRepoAction(formData: FormData): Promise<void> {
  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  const id = String(formData.get('id') ?? '')
  if (sessionToken && id) await refreshConnectedRepo(sessionToken, id)
  revalidatePath('/settings/github')
}

export async function disconnectRepoAction(formData: FormData): Promise<void> {
  const jar = await cookies()
  const sessionToken = readSessionCookie(jar)
  const id = String(formData.get('id') ?? '')
  if (sessionToken && id) await disconnectConnectedRepo(sessionToken, id)
  revalidatePath('/settings/github')
}
