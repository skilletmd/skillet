import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import type { JobId } from '@skillet/protocol/jobs'
import {
  parseKitMapDocument,
  parseKitMapMerge,
  type KitMapDocument,
  type KitMapMerge,
  type KitMapSavedEntry,
} from '@skillet/protocol/kit-map'
import { SavedMap } from '@/components/map/kit-map-view'
import { MapMerges, type MapMergeItem, type MapMergesDemo, type MergeComputer } from '@/components/map/merge-pick'
import { REGISTRY_API } from '@/lib/registry-prefix'
import { registryFetchOriginOrDefault } from '@/lib/registry-origin'
import { requireSession } from '@/lib/require-session'
import { readSessionCookie } from '@/lib/session-cookie'
import type { BundleFiles } from '@/lib/skill-bundle'

// skillet.md/map: the signed-in person's saved kit map, read-only. Save writes it
// from the computer; changing it means running the line again. Above it, a line
// for every drafted merge, where a ready one is picked blind and a kept one
// publishes (U15).

export const metadata: Metadata = {
  title: 'Your kit map · Skillet',
  robots: { index: false, follow: false },
}

/** One registry read as the signed-in person, or null when it fails. */
async function readJson(token: string, path: string): Promise<{ status: number; body: unknown } | null> {
  try {
    const res = await fetch(`${registryFetchOriginOrDefault()}${REGISTRY_API}/${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    })
    return { status: res.status, body: res.ok ? ((await res.json()) as unknown) : null }
  } catch {
    return null
  }
}

/** The saved map, null when the account has none yet, or 'error' when it can't be read. */
async function readSavedMap(token: string): Promise<KitMapDocument | null | 'error'> {
  const res = await readJson(token, 'kit-map')
  if (res?.status === 404) return null
  if (!res || res.status !== 200) return 'error'
  return parseKitMapDocument(res.body) ?? 'error'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** The account's computers, and whether each machine runs the app (desktop and CLI rows share a machine). */
function computersOf(body: unknown): MergeComputer[] {
  const rows = isRecord(body) && Array.isArray(body.devices) ? body.devices.filter(isRecord) : []
  const kinds = (row: Record<string, unknown>) => [
    ...(typeof row.client_kind === 'string' ? [row.client_kind] : []),
    ...(Array.isArray(row.client_kinds) ? row.client_kinds.filter((k): k is string => typeof k === 'string') : []),
  ]
  return rows.flatMap((row) => {
    if (typeof row.device_id !== 'string') return []
    const machine = typeof row.machine_id === 'string' ? row.machine_id : null
    const siblings = machine ? rows.filter((r) => r.machine_id === machine) : [row]
    return [
      {
        id: row.device_id,
        label: typeof row.label === 'string' && row.label.trim() !== '' ? row.label : 'your computer',
        app: siblings.some((r) => kinds(r).includes('desktop')),
      },
    ]
  })
}

/** A merged skill's backup: its name, the tools it goes into, and its bundle for Publish. */
function skillOf(body: unknown): MapMergeItem['skill'] {
  if (!isRecord(body) || typeof body.name !== 'string') return null
  return {
    name: body.name,
    tools: Array.isArray(body.tools) ? body.tools.filter((t): t is string => typeof t === 'string') : [],
    ...(isRecord(body.files) ? { files: body.files as BundleFiles } : {}),
  }
}

/** Every drafted merge, with what its line and its pick need, or null when the merges can't be read. */
async function readMerges(token: string): Promise<{ items: MapMergeItem[]; computers: MergeComputer[] } | null> {
  const [list, devices] = await Promise.all([readJson(token, 'map-merges'), readJson(token, 'devices')])
  if (!list || list.status !== 200 || !isRecord(list.body) || !Array.isArray(list.body.merges)) return null
  const merges = list.body.merges.map((m) => parseKitMapMerge(m)).filter((m): m is KitMapMerge => m !== null)
  const items = await Promise.all(
    merges.map(async (merge): Promise<MapMergeItem> => {
      const [detail, backup] = await Promise.all([
        merge.status === 'ready' ? readJson(token, `map-merges/${encodeURIComponent(merge.id)}`) : null,
        merge.merged && ['ready', 'picked', 'applied'].includes(merge.status)
          ? readJson(token, `backups/${encodeURIComponent(merge.merged)}`)
          : null,
      ])
      const full = detail?.status === 200 ? parseKitMapMerge(detail.body) : null
      return { merge: full ?? merge, skill: backup?.status === 200 ? skillOf(backup.body) : null }
    }),
  )
  return { items, computers: devices?.status === 200 ? computersOf(devices.body) : [] }
}

const namesOf = (doc: KitMapDocument | null | 'error'): Record<string, string> =>
  doc !== null && doc !== 'error' ? Object.fromEntries(doc.entries.map((entry) => [entry.key, entry.name])) : {}

export default async function SavedMapPage({ searchParams }: { searchParams: Promise<{ demo?: string | string[] }> }) {
  const sp = await searchParams
  // `?demo=map|empty|error` draws a state with fixtures for visual checks, in dev
  // only, and so do the merge states (`merges`) and each step of the pick
  // (`pick-1` to `pick-4`, `pick-won`, `pick-lost`).
  if (process.env.NODE_ENV !== 'production' && typeof sp.demo === 'string') {
    const merges = demoMerges(sp.demo)
    if (merges) {
      return (
        <>
          <MapMerges merges={merges.items} names={DEMO_NAMES} computers={DEMO_COMPUTERS} handle="test-user" demo={merges.demo} />
          <SavedMap doc={DEMO_MERGE_MAP} />
        </>
      )
    }
    const demo = demoDoc(sp.demo)
    if (demo !== undefined) return <SavedMap doc={demo} />
  }

  const session = await requireSession('/map')
  const token = readSessionCookie(await cookies())
  if (!token) return <SavedMap doc="error" />
  const [doc, merges] = await Promise.all([readSavedMap(token), readMerges(token)])
  return (
    <>
      {merges && merges.items.length > 0 && (
        <MapMerges merges={merges.items} names={namesOf(doc)} computers={merges.computers} handle={session.handle ?? null} />
      )}
      <SavedMap doc={doc} />
    </>
  )
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

/** The saved map a `?demo` draws: the fixture, none yet, or one that couldn't be read. Undefined for any other demo. */
function demoDoc(demo: string): KitMapDocument | null | 'error' | undefined {
  switch (demo) {
    case 'map':
      return DEMO_MAP
    case 'empty':
      return null
    case 'error':
      return 'error'
    default:
      return undefined
  }
}

// ---------------------------------------------------------------------------
// The merge fixtures: the map above, with three more editing skills merged
// ---------------------------------------------------------------------------

const EDITING_ROWS = [DEMO_ROWS[0], saved('Copy Editor', 'writing.editing'), saved('Line Editor', 'writing.editing'), saved('Proofread', 'writing.editing')]
const MERGE_ROWS = [...DEMO_ROWS, ...EDITING_ROWS.slice(1)]
const DEMO_MERGE_MAP: KitMapDocument = {
  version: 1,
  entries: MERGE_ROWS.map(([entry]) => entry),
  assignments: Object.fromEntries(MERGE_ROWS.map(([entry, job]) => [entry.key, job])),
}
const DEMO_NAMES: Record<string, string> = Object.fromEntries(MERGE_ROWS.map(([entry]) => [entry.key, entry.name]))
const keysOf = (rows: ReadonlyArray<[KitMapSavedEntry, JobId | null]>) => rows.map(([entry]) => entry.key)

const DEMO_COMPUTERS: MergeComputer[] = [
  { id: 'demo-device-1', label: 'test-machine', app: true },
  { id: 'demo-device-2', label: 'test-machine-2', app: false },
]

const DEMO_MERGED = `sha256:${'f'.repeat(63)}0`
const DEMO_BRIEF = 'Tighten this note for a stranger: the team meeting moved from Thursday at 3pm to Friday at 10am, same room.'
const DEMO_SAMPLES: Array<[merged: string, original: string]> = [
  [
    'The team meeting moved to Friday at 10am. Same room.',
    "Heads up: we've moved the team meeting. It's now Friday at 10am instead of Thursday at 3pm. Same room as always.",
  ],
  [
    'Team meeting: now Friday, 10am, same room.',
    'Please note the team meeting has been rescheduled from Thursday 3pm to Friday 10am. The location is unchanged.',
  ],
  ['We moved the team meeting to Friday at 10am. Same room as before.', 'Team meeting moved: Friday 10am (was Thursday 3pm). Same room.'],
  ["Friday, 10am: the team meeting's new time. Same room.", 'The team meeting is now on Friday at 10 am, in the same room.'],
]

function demoSkill(name: string): NonNullable<MapMergeItem['skill']> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  return {
    name,
    tools: ['claude-code', 'codex'],
    files: { 'SKILL.md': { enc: 'utf8', data: `---\nname: ${slug}\ndescription: ${name}, merged.\n---\n\n# ${name}\n` } },
  }
}

function demoMerge(id: string, job: JobId, keys: string[], over: Partial<KitMapMerge>): KitMapMerge {
  return { id, device: 'demo-device-1', job, keys, status: 'waiting', updatedAt: 1_790_000_000, ...over }
}

const EDITING_KEYS = keysOf(EDITING_ROWS)
const READY: MapMergeItem = {
  merge: demoMerge('demo-editing', 'writing.editing', EDITING_KEYS, {
    status: 'ready',
    merged: DEMO_MERGED,
    brief: DEMO_BRIEF,
    rounds: EDITING_KEYS.map((key, i) => ({ key, merged: DEMO_SAMPLES[i][0], original: DEMO_SAMPLES[i][1] })),
  }),
  skill: demoSkill('Editing'),
}

function demoMerges(demo: string): { items: MapMergeItem[]; demo: MapMergesDemo } | null {
  const pr = keysOf(DEMO_ROWS.filter(([, job]) => job === 'development.pull-requests'))
  const pair = (a: number, b: number) => [DEMO_ROWS[a][0].key, DEMO_ROWS[b][0].key]
  if (demo === 'merges') {
    return {
      demo: {},
      items: [
        READY,
        { merge: demoMerge('demo-prs', 'development.pull-requests', pr, { status: 'picked', merged: DEMO_MERGED }), skill: demoSkill('Pull Requests') },
        { merge: demoMerge('demo-posts', 'writing.short-posts', pair(1, 15), { status: 'waiting' }) },
        { merge: demoMerge('demo-docs', 'writing.docs', pair(2, 12), { status: 'writing' }) },
        { merge: demoMerge('demo-emails', 'writing.emails', pair(13, 15), { status: 'failed', reason: 'no-ai-tool' }) },
        { merge: demoMerge('demo-landing', 'marketing.landing-pages', pair(3, 4), { status: 'applied', merged: DEMO_MERGED }), skill: demoSkill('Landing Pages') },
        {
          merge: demoMerge('demo-review', 'development.code-review', pair(6, 7), { status: 'applied', merged: DEMO_MERGED, published: '@test-user/code-review' }),
          skill: demoSkill('Code Review'),
        },
        { merge: demoMerge('demo-meetings', 'business.meetings', pair(13, 12), { status: 'out-of-date', reason: 'sources-changed' }) },
        {
          merge: demoMerge('demo-ui', 'design.interfaces', pair(4, 5), { status: 'picked', merged: DEMO_MERGED, device: 'demo-device-2' }),
          skill: demoSkill('Interfaces'),
        },
      ],
    }
  }
  const round = /^pick-([1-4])$/.exec(demo)
  if (round) {
    // Rounds already played went to whichever side holds the merged sample, so each step shows the next round.
    return { items: [READY], demo: { open: READY.merge.id, wins: Array.from({ length: Number(round[1]) - 1 }, () => true) } }
  }
  if (demo === 'pick-won') return { items: [READY], demo: { open: READY.merge.id, wins: [true, true, false, true] } }
  if (demo === 'pick-lost') return { items: [READY], demo: { open: READY.merge.id, wins: [true, false, true, false] } }
  return null
}
