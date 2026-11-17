import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import type { JobId } from '@skillet/protocol/jobs'
import { parseKitMapDocument, type KitMapDocument, type KitMapSavedEntry } from '@skillet/protocol/kit-map'
import { SavedMap } from '@/components/map/kit-map-view'
import { REGISTRY_API } from '@/lib/registry-prefix'
import { registryFetchOriginOrDefault } from '@/lib/registry-origin'
import { requireSession } from '@/lib/require-session'
import { readSessionCookie } from '@/lib/session-cookie'

// skillet.md/map: the signed-in person's saved kit map, read-only. Save writes it
// from the computer; changing it means running the line again. Merges join it
// later (U15).

export const metadata: Metadata = {
  title: 'Your kit map · Skillet',
  robots: { index: false, follow: false },
}

/** The saved map, null when the account has none yet, or 'error' when it can't be read. */
async function readSavedMap(token: string): Promise<KitMapDocument | null | 'error'> {
  try {
    const res = await fetch(`${registryFetchOriginOrDefault()}${REGISTRY_API}/kit-map`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    if (res.status === 404) return null
    if (!res.ok) return 'error'
    return parseKitMapDocument(await res.json()) ?? 'error'
  } catch {
    return 'error'
  }
}

export default async function SavedMapPage({ searchParams }: { searchParams: Promise<{ demo?: string | string[] }> }) {
  const sp = await searchParams
  // `?demo=map|empty|error` draws a state with fixtures for visual checks, in dev only.
  if (process.env.NODE_ENV !== 'production' && typeof sp.demo === 'string') {
    const demo = sp.demo === 'map' ? DEMO_MAP : sp.demo === 'empty' ? null : sp.demo === 'error' ? 'error' : undefined
    if (demo !== undefined) return <SavedMap doc={demo} />
  }

  await requireSession('/map')
  const token = readSessionCookie(await cookies())
  return <SavedMap doc={token ? await readSavedMap(token) : 'error'} />
}

// ---------------------------------------------------------------------------
// The ?demo=map fixture: made-up skills, never an account's
// ---------------------------------------------------------------------------

let demoSeq = 0
function saved(name: string, job: JobId | null, over: Partial<KitMapSavedEntry> = {}): [KitMapSavedEntry, JobId | null] {
  demoSeq += 1
  return [{ key: `sha256:${demoSeq.toString(16).padStart(64, '0')}`, name, description: '', source: 'local', ...over }, job]
}

const DEMO_ROWS = [
  saved('Plain Prose', 'writing.editing'),
  saved('Thread Writer', 'writing.short-posts'),
  saved('Readme Writer', 'writing.docs'),
  saved('Write Landing', 'marketing.landing-pages', { source: 'skillet-added', skillet: { ref: '@openclaudia/write-landing', name: 'Write Landing' } }),
  saved('Interface Polish', 'design.interfaces'),
  saved('Design Review', 'design.design-reviews', { source: 'plugin', from: { kind: 'plugin', name: 'compound-engineering' } }),
  saved('Code Review', 'development.code-review', { source: 'plugin', from: { kind: 'plugin', name: 'compound-engineering' } }),
  saved('TDD', 'development.tests', { source: 'skillet-added', skillet: { ref: '@mattpocock/tdd', name: 'TDD' } }),
  saved('PR Writer', 'development.pull-requests'),
  saved('Commit Helper', 'development.pull-requests'),
  saved('Workers', 'development.platforms'),
  saved('Wrangler', 'development.platforms'),
  saved('Deep Research', 'research.web-research'),
  saved('Meeting Notes', 'business.meetings'),
  saved('Agent Browser', 'tools.browser', { source: 'skillet-added', skillet: { ref: '@vercel/agent-browser', name: 'Agent Browser' } }),
  saved('Morning Brief', null),
]

const DEMO_MAP: KitMapDocument = {
  version: 1,
  entries: DEMO_ROWS.map(([entry]) => entry),
  assignments: Object.fromEntries(DEMO_ROWS.map(([entry, job]) => [entry.key, job])),
}
