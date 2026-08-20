import { cache } from 'react'
import { cookies } from 'next/headers'
import { listMineKitsRequest, type MineKitsPayload } from '@/lib/kits'
import { readSessionCookie } from '@/lib/session-cookie'
import { REGISTRY_API } from '@/lib/registry-prefix'
import { browseSsrLog, browseSsrProbeClock, browseSsrSpan } from '@/lib/browse-ssr-probe'

export interface MeBootstrap {
  viewerHandle: string
  kits: MineKitsPayload
  curations: Record<string, string[]>
  /** Author handles the viewer follows — bootstraps the live follow context. */
  following: string[]
}

function registryBaseUrl(): string {
  return process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
}

async function fetchFollowedCurations(
  registryUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string[]>> {
  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/me/followed-curations`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) return {}
  const data = (await res.json()) as { curations?: Record<string, string[]> }
  return data.curations ?? {}
}

async function fetchFollowedAuthors(
  registryUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/me/following`, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    cache: 'no-store',
  })
  if (!res.ok) return []
  const data = (await res.json()) as {
    following?: { subject_kind?: string; subject_id?: string }[]
  }
  return (data.following ?? [])
    .filter((f) => f.subject_kind === 'author' && typeof f.subject_id === 'string')
    .map((f) => String(f.subject_id))
}

/** Session-scoped kit membership + followed curations for client provider bootstrap. */
export const getMeBootstrap = cache(async (viewerHandle: string): Promise<MeBootstrap | null> => {
  const totalStarted = browseSsrProbeClock()
  browseSsrLog('bootstrap_enter', { viewer: viewerHandle ? 'set' : 'empty' })

  const jar = await cookies()
  const token = readSessionCookie(jar)
  if (!token) {
    browseSsrLog('bootstrap_skip', { reason: 'no_token' })
    return null
  }

  const registryUrl = registryBaseUrl()
  // Each fetch can throw on a transient network/registry blip — not just return a
  // non-ok status. Settle them independently so one failure never 500s the page.
  const [mineSettled, curationsSettled, followingSettled] = await Promise.allSettled([
    browseSsrSpan('bootstrap_mine_kits', () => listMineKitsRequest(registryUrl, token)),
    browseSsrSpan('bootstrap_curations', () => fetchFollowedCurations(registryUrl, token)),
    browseSsrSpan('bootstrap_following', () => fetchFollowedAuthors(registryUrl, token)),
  ])

  // Kits: a non-ok result (e.g. unauthorized) still means "no bootstrap", as
  // before. A thrown/rejected request degrades to an empty kit list instead.
  let kits: MineKitsPayload
  if (mineSettled.status === 'fulfilled') {
    if (mineSettled.value.kind !== 'ok') {
      browseSsrLog('bootstrap_done', {
        outcome: 'mine_not_ok',
        ms: totalStarted ? browseSsrProbeClock() - totalStarted : undefined,
      })
      return null
    }
    kits = mineSettled.value.data
  } else {
    kits = { owned: [], member: [], subscribed: [], author_kits: [] }
  }

  const curations = curationsSettled.status === 'fulfilled' ? curationsSettled.value : {}
  const following = followingSettled.status === 'fulfilled' ? followingSettled.value : []

  browseSsrLog('bootstrap_done', {
    outcome: 'ok',
    following_n: following.length,
    curations_n: Object.keys(curations).length,
    mine_ok: mineSettled.status === 'fulfilled',
    ms: totalStarted ? browseSsrProbeClock() - totalStarted : undefined,
  })

  return {
    viewerHandle,
    kits,
    curations,
    following,
  }
})

export {
  fetchFollowedCurations,
  fetchFollowedAuthors,
  registryBaseUrl as meBootstrapRegistryBaseUrl,
}
