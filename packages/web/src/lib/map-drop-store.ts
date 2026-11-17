import type { FolderBlob, FolderDir, FolderFile, FolderItem } from '@/components/map/folder-drop'
import type { NotBackedUp } from '@/components/map/save-flow'
import { addSkillToKit } from '@/lib/add-intent'
import { registryAuthApi } from '@/lib/registry-proxy'
import { canonicalContentHash } from '@/lib/webcrypto-content-hash'
import type { JobId } from '@skillet/protocol/jobs'
import {
  backsUp,
  deriveKitMapChanges,
  parseKitMapDocument,
  parseKitMapDrafts,
  parseKitMapPendingChange,
  parseKitMapScan,
  toSavedEntry,
  type KitMapChanges,
  type KitMapDocument,
  type KitMapDraft,
  type KitMapEntry,
  type KitMapPendingChange,
  type KitMapSaveCounts,
  type KitMapSavedEntry,
  type KitMapScan,
} from '@skillet/protocol/kit-map'

/**
 * A map built from a dropped folder: what it keeps for Save, and Save itself
 * (kit map onboarding, U12; KTD9, KTD15; R3 R18 R20).
 *
 * The bytes come from folder-drop's own read. `recordReads` wraps the folder it
 * reads and remembers every file it opens, so a backup carries exactly the
 * files and bytes the key covers, by the CLI's file rule, without a second read
 * or a second copy of that rule.
 *
 * A signed-out Save keeps the map, its bundles and the drafts in this browser's
 * IndexedDB before the sign-in redirect, and the page restores them on the way
 * back. They are cleared once Save finishes, on Start over, and by the first
 * visit after 24 hours. A visit with nothing kept creates no database.
 *
 * Save runs in this tab with the person's session, through the same-origin
 * registry proxy: it backs up each kept skill by hash, adds picks to the
 * account's Saved kit, records removes and merges as changes with no computer
 * (the browser can't write files), and saves the map's jobs. Every step can run
 * again, so Try again finishes what's left.
 */

/** A skill's files by path in its folder: the bytes its key was computed over. */
export type DropBundle = ReadonlyMap<string, Uint8Array>
/** Bundles by key. */
export type DropBundles = ReadonlyMap<string, DropBundle>

const SKILL_FILE = 'SKILL.md'
const SUFFIX = `/${SKILL_FILE}`

/** A wrapped folder, and the skills it was read into, by key. */
export interface ReadRecorder {
  /** Hand this to `readSkillsFolder` in place of the folder. */
  root: FolderDir
  /** The skills read whose key is one of `keys`, each with its files. */
  bundles(keys: Iterable<string>): Promise<Map<string, DropBundle>>
}

export function recordReads(root: FolderDir): ReadRecorder {
  /** Every file read, by its path below the chosen folder. */
  const read = new Map<string, Uint8Array>()
  const join = (at: string, name: string) => (at === '' ? name : `${at}/${name}`)

  const file = (item: FolderFile, path: string): FolderFile => ({
    kind: 'file',
    name: item.name,
    open: async (): Promise<FolderBlob> => {
      const blob = await item.open()
      return {
        size: blob.size,
        arrayBuffer: async () => {
          const buffer = await blob.arrayBuffer()
          read.set(path, new Uint8Array(buffer))
          return buffer
        },
      }
    },
  })
  const dir = (item: FolderDir, path: string): FolderDir => ({
    kind: 'dir',
    name: item.name,
    list: async (max) =>
      (await item.list(max)).map((child: FolderItem) =>
        child.kind === 'dir' ? dir(child, join(path, child.name)) : file(child, join(path, child.name)),
      ),
  })

  return {
    root: dir(root, ''),
    async bundles(keys) {
      const wanted = new Set(keys)
      // A skill is a folder whose own SKILL.md was read; a SKILL.md below one is part of it.
      const folders = [...read.keys()]
        .filter((path) => path === SKILL_FILE || path.endsWith(SUFFIX))
        .map((path) => path.slice(0, -SKILL_FILE.length).replace(/\/$/, ''))
      const below = (path: string, folder: string) => folder === '' || path.startsWith(`${folder}/`)
      const skills = folders.filter((folder) => !folders.some((other) => other !== folder && below(folder, other)))

      const out = new Map<string, DropBundle>()
      for (const folder of skills) {
        const bundle = new Map<string, Uint8Array>()
        for (const [path, bytes] of read) {
          if (below(path, folder)) bundle.set(folder === '' ? path : path.slice(folder.length + 1), bytes)
        }
        const key = await canonicalContentHash(bundle)
        if (wanted.has(key) && !out.has(key)) out.set(key, bundle)
      }
      return out
    },
  }
}

// ---------------------------------------------------------------------------
// The wire form of a backup's files
// ---------------------------------------------------------------------------

export interface BackupFile {
  enc: 'utf8' | 'base64'
  data: string
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(binary)
}

/** Text that round-trips as UTF-8 travels as text, anything else as base64: protocol's `encodeBundle`. */
function encodeFile(bytes: Uint8Array): BackupFile {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    const back = new TextEncoder().encode(text)
    if (back.length === bytes.length && back.every((byte, at) => byte === bytes[at])) return { enc: 'utf8', data: text }
  } catch {
    // Not UTF-8.
  }
  return { enc: 'base64', data: toBase64(bytes) }
}

/** A bundle as `PUT /backups/:hash` takes its `files`. */
export function backupFiles(bundle: DropBundle): Record<string, BackupFile> {
  // No prototype, so a file named __proto__ is a file.
  const out = Object.create(null) as Record<string, BackupFile>
  for (const [path, bytes] of bundle) out[path] = encodeFile(bytes)
  return out
}

// ---------------------------------------------------------------------------
// Kept through sign-in
// ---------------------------------------------------------------------------

/** What a signed-out Save keeps, and the page restores on the way back. */
export interface KeptDrop {
  scan: KitMapScan
  /** Folders the read couldn't open, for the map's header line. */
  missed: number
  drafts: KitMapDraft[]
  bundles: DropBundles
}

/** How long a kept map lasts. */
export const KEEP_MS = 24 * 60 * 60 * 1000

const DB_NAME = 'skillet-map-drop'
const DB_VERSION = 1
const STORE = 'maps'
const KEY = 'dropped'
const FORMAT = 1

interface Stored {
  format: number
  keptAt: number
  scan: unknown
  missed: unknown
  drafts: unknown
  bundles: unknown
}

/** The database, or null when `create` is false and it doesn't exist yet. Rejects without IndexedDB. */
function openDb(create: boolean): Promise<IDBDatabase | null> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined' || !indexedDB) {
      reject(new Error('IndexedDB is unavailable'))
      return
    }
    let missing = false
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (event) => {
      if (!create && event.oldVersion === 0) {
        // Opening made it: undo that, so a visit with nothing kept leaves nothing behind.
        missing = true
        req.transaction?.abort()
        return
      }
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = (event) => {
      if (!missing) return reject(req.error ?? new Error('Could not open IndexedDB'))
      // The abort above, not a failure worth reporting.
      event?.preventDefault?.()
      resolve(null)
    }
  })
}

/** One request in its own transaction, resolved once the transaction completes. */
function run<T>(db: IDBDatabase, mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    const req = make(tx.objectStore(STORE))
    tx.oncomplete = () => resolve(req.result)
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  }).finally(() => db.close())
}

/** Keeps the map in this browser. False when IndexedDB isn't there or won't take it. */
export async function keepDrop(drop: KeptDrop, now = Date.now()): Promise<boolean> {
  const stored: Stored = {
    format: FORMAT,
    keptAt: now,
    scan: drop.scan,
    missed: drop.missed,
    drafts: drop.drafts,
    bundles: [...drop.bundles].map(([key, bundle]) => [key, [...bundle]]),
  }
  try {
    const db = await openDb(true)
    if (!db) return false
    await run(db, 'readwrite', (store) => store.put(stored, KEY))
    return true
  } catch {
    return false
  }
}

function readBundles(value: unknown, keys: ReadonlySet<string>): Map<string, DropBundle> | null {
  if (!Array.isArray(value)) return null
  const out = new Map<string, DropBundle>()
  for (const item of value) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string' || !keys.has(item[0]) || !Array.isArray(item[1])) {
      return null
    }
    const bundle = new Map<string, Uint8Array>()
    for (const file of item[1] as unknown[]) {
      if (!Array.isArray(file) || typeof file[0] !== 'string') return null
      // By its internal tag, not instanceof: a structured clone may come from another realm.
      const bytes: unknown = file[1]
      if (!ArrayBuffer.isView(bytes) || Object.prototype.toString.call(bytes) !== '[object Uint8Array]') return null
      bundle.set(file[0], new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    }
    out.set(item[0], bundle)
  }
  return out
}

/** The kept map, checked as the map would check it, or null when it's past 24 hours or unreadable. */
function readKept(value: unknown, now: number): KeptDrop | null {
  if (typeof value !== 'object' || value === null) return null
  const stored = value as Stored
  if (stored.format !== FORMAT || typeof stored.keptAt !== 'number' || now - stored.keptAt > KEEP_MS) return null
  const scan = parseKitMapScan(stored.scan)
  if (!scan || scan.connected !== undefined) return null
  const drafts = parseKitMapDrafts(stored.drafts, scan.entries)
  const missed = stored.missed
  if (!drafts || typeof missed !== 'number' || !Number.isInteger(missed) || missed < 0) return null
  const bundles = readBundles(stored.bundles, new Set(scan.entries.map((entry) => entry.key)))
  return bundles ? { scan, missed, drafts, bundles } : null
}

/** Reads what's kept, clearing it when it's past 24 hours or unreadable. */
async function look(now: number, restore: boolean): Promise<KeptDrop | null> {
  try {
    const db = await openDb(false)
    if (!db) return null
    const value = await run(db, 'readonly', (store) => store.get(KEY) as IDBRequest<unknown>)
    if (value === undefined) return null
    const kept = readKept(value, now)
    if (!kept) await forgetDrop()
    return restore ? kept : null
  } catch {
    return null
  }
}

/** The map kept before sign-in, or null when nothing fresh is kept. */
export function restoreDrop(now = Date.now()): Promise<KeptDrop | null> {
  return look(now, true)
}

/** Clears a kept map past 24 hours. Creates nothing when there's none. */
export async function sweepDrop(now = Date.now()): Promise<void> {
  await look(now, false)
}

/** Clears the kept map. Never throws. */
export async function forgetDrop(): Promise<void> {
  try {
    const db = await openDb(false)
    if (db) await run(db, 'readwrite', (store) => store.delete(KEY))
  } catch {
    // Nothing kept, or nothing to keep it in.
  }
}

// ---------------------------------------------------------------------------
// Save, from this tab
// ---------------------------------------------------------------------------

interface Answer {
  /** 0 when the request never got an answer. */
  status: number
  body: unknown
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

async function send(method: string, path: string, body?: unknown): Promise<Answer> {
  try {
    const res = await fetch(registryAuthApi(path), {
      method,
      cache: 'no-store',
      headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: res.status, body: await res.json().catch(() => null) }
  } catch {
    return { status: 0, body: null }
  }
}

/** The account this tab's session belongs to, as the registry sees it. */
export type DropAccount = { kind: 'signed-in'; handle: string | null } | { kind: 'signed-out' } | { kind: 'unreachable' }

export async function readDropAccount(): Promise<DropAccount> {
  const answer = await send('GET', 'whoami')
  if (answer.status === 401) return { kind: 'signed-out' }
  if (answer.status !== 200 || !isRecord(answer.body)) return { kind: 'unreachable' }
  const handle = answer.body.handle
  return { kind: 'signed-in', handle: typeof handle === 'string' && handle !== '' ? handle : null }
}

export interface DropSaveRequest {
  entries: readonly KitMapEntry[]
  drafts: readonly KitMapDraft[]
  bundles: DropBundles
  /** The account's username: its Saved kit takes the picks. */
  handle: string
  /** A pick's name, for Done. */
  pickName: (ref: string) => string
  /** `saving` while it records and backs up, `applying` while it adds picks and saves the map. */
  onStep?: (step: 'saving' | 'applying') => void
}

/** What a dropped folder's Save did. It moves and merges nothing itself: the app does (R20). */
export interface DropSaveResult {
  /** `partial`: something can go through on Try again. `failed`: it stopped, see `reason`. */
  result: 'applied' | 'partial' | 'failed'
  reason?: 'signed-out' | 'unreachable'
  /** Skills backed up and picks added. Removals and merges stay at zero. */
  counts: KitMapSaveCounts
  /** Removes and merges waiting for the app, with no computer yet. */
  waiting: { removals: number; merges: number }
  /** Skills that won't back up as they are, and why. */
  notBackedUp: NotBackedUp[]
  /** Skills whose backup didn't go through this time, by name. */
  unsent: string[]
  /** Picks Skillet wouldn't add, by name, and why. */
  notAdded: { name: string; reason: string }[]
  /** Picks that didn't go through this time. */
  unadded: number
  /** The map's jobs and moves are on the account. */
  mapSaved: boolean
}

const BACKUPS_AT_ONCE = 4
const MAP_WRITES = 4
/** What the registry answers when a pick isn't one it will add: private, gone, quarantined, or not addable. */
const REFUSED_FILLS = new Set([403, 404, 410, 422, 451])
const FILE_MAX = 255

async function eachAtOnce<T>(items: readonly T[], width: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  const worker = async () => {
    while (next < items.length) await run(items[next++]!)
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker))
}

const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join()

/** Why the registry wouldn't keep a backup, or null when it did; `retry` when trying again may work. */
function backupRefusal(answer: Answer): Omit<NotBackedUp, 'name'> | 'retry' | null {
  if (answer.status === 200 || answer.status === 201) return null
  const body = isRecord(answer.body) ? answer.body : {}
  if (answer.status === 422 && body.error === 'scan_blocked') {
    const finding = Array.isArray(body.findings) && isRecord(body.findings[0]) ? body.findings[0] : {}
    const file = typeof finding.file === 'string' ? finding.file.trim().slice(0, FILE_MAX) : ''
    const line = finding.lineStart
    return {
      reason: 'secret',
      ...(file ? { file } : {}),
      ...(typeof line === 'number' && Number.isInteger(line) && line > 0 ? { line } : {}),
    }
  }
  if (answer.status === 413) return { reason: body.error === 'backup_quota_exceeded' ? 'quota' : 'too-large' }
  if (answer.status === 422 || answer.status === 400) return { reason: 'refused' }
  return 'retry'
}

/** The saved map with this folder's skills in it, kept on top of what other computers saved. */
function mapDocument(
  base: KitMapDocument | null,
  entries: readonly KitMapEntry[],
  derived: KitMapChanges,
  removed: ReadonlySet<string>,
): KitMapDocument {
  const moved = new Set(derived.changes.flatMap((change) => (change.kind === 'move' ? [change.key] : [])))
  const kept = new Map<string, KitMapSavedEntry>()
  for (const entry of base?.entries ?? []) if (!removed.has(entry.key)) kept.set(entry.key, entry)
  const assignments: Record<string, JobId | null> = {}
  for (const [key, job] of Object.entries(base?.assignments ?? {})) if (kept.has(key)) assignments[key] = job
  for (const entry of entries) {
    if (removed.has(entry.key)) continue
    kept.set(entry.key, toSavedEntry(entry))
    const saved = base?.assignments[entry.key]
    const here = derived.jobs.has(entry.key) ? (derived.jobs.get(entry.key) ?? null) : entry.job
    // A move made here wins; otherwise a job saved before stays.
    assignments[entry.key] = moved.has(entry.key) || saved === undefined ? here : saved
  }
  return { version: base?.version ?? 0, entries: [...kept.values()], assignments }
}

/**
 * Save from this tab (see the module comment). The person confirmed the
 * account `handle` names. A 401 anywhere means the session ended: it stops
 * there, and Save again signs in and finishes.
 */
export async function saveDroppedMap({ entries, drafts, bundles, handle, pickName, onStep }: DropSaveRequest): Promise<DropSaveResult> {
  const derived = deriveKitMapChanges(drafts, entries)
  const removes = derived.changes.flatMap((change) => (change.kind === 'remove' ? [change] : []))
  const merges = derived.changes.flatMap((change) => (change.kind === 'merge' ? [change] : []))
  const fills = derived.changes.flatMap((change) => (change.kind === 'fill' ? [change] : []))
  const removed = new Set(removes.map((change) => change.key))
  const out: DropSaveResult = {
    result: 'applied',
    counts: { backups: 0, removals: 0, fills: 0, merges: 0 },
    waiting: { removals: 0, merges: 0 },
    notBackedUp: [],
    unsent: [],
    notAdded: [],
    unadded: 0,
    mapSaved: false,
  }
  let signedOut = false
  const call = async (method: string, path: string, body?: unknown) => {
    const answer = await send(method, path, body)
    if (answer.status === 401) signedOut = true
    return answer
  }
  const stop = (): DropSaveResult => ({ ...out, result: 'failed', reason: signedOut ? 'signed-out' : 'unreachable' })

  onStep?.('saving')

  // 1. Removes and merges wait for the app: changes with no computer, recorded
  // once, which the first computer that connects and holds these skills claims.
  if (removes.length + merges.length > 0) {
    const open = await call('GET', 'kit-map/changes')
    if (open.status !== 200) return stop()
    const waiting = (isRecord(open.body) && Array.isArray(open.body.changes) ? open.body.changes : [])
      .map((change) => parseKitMapPendingChange(change))
      .filter((change): change is KitMapPendingChange => change !== null)
    const record = [
      ...removes
        .filter((draft) => !waiting.some((w) => w.kind === 'remove' && w.key === draft.key))
        .map((draft) => ({ kind: 'remove', key: draft.key })),
      ...merges
        .filter((draft) => !waiting.some((w) => w.kind === 'merge' && w.job === draft.job && sameKeys(w.keys, draft.keys)))
        .map((draft) => ({ kind: 'merge', job: draft.job, keys: [...draft.keys] })),
    ]
    if (record.length > 0) {
      const made = await call('POST', 'kit-map/changes', { changes: record })
      if (made.status !== 201 && made.status !== 200) return stop()
    }
    out.waiting = { removals: removes.length, merges: merges.length }
  }

  // 2. Back up the person's own skills by hash, skipping what the account holds.
  // A removed skill waits too: the app backs it up before it moves it.
  const backing = entries.filter((entry) => backsUp(entry) && !removed.has(entry.key))
  const listed = backing.length > 0 ? await call('GET', 'backups') : { status: 0, body: null }
  const stored = new Set(
    (isRecord(listed.body) && Array.isArray(listed.body.backups) ? listed.body.backups : []).flatMap((row) =>
      isRecord(row) && typeof row.hash === 'string' ? [row.hash] : [],
    ),
  )
  const outcome = new Map<string, Omit<NotBackedUp, 'name'> | 'retry' | null>()
  const backUp = async (entry: KitMapEntry): Promise<Omit<NotBackedUp, 'name'> | 'retry' | null> => {
    if (stored.has(entry.key)) return null
    const bundle = bundles.get(entry.key)
    if (!bundle) return { reason: 'unreadable' }
    // Once the session ends, the rest wait for Save again.
    if (signedOut) return 'retry'
    const put = await call('PUT', `backups/${entry.key.replace(/^sha256:/, '')}`, {
      files: backupFiles(bundle),
      name: entry.name,
      description: entry.description,
      tools: [],
      origin: 'drop',
    })
    return backupRefusal(put)
  }
  await eachAtOnce(backing, BACKUPS_AT_ONCE, async (entry) => {
    outcome.set(entry.key, await backUp(entry))
  })
  // In map order, whatever order they finished in, with the skills the read
  // itself flagged (too big, a .git folder), which never went up.
  for (const entry of entries) {
    if (entry.source !== 'local' || removed.has(entry.key)) continue
    const result = entry.noBackup ?? outcome.get(entry.key)
    if (result === null) out.counts.backups += 1
    else if (result === undefined || result === 'retry') out.unsent.push(entry.name)
    else out.notBackedUp.push({ name: entry.name, ...result })
  }
  if (signedOut) return stop()

  // 3. Picks go into the account's Saved kit, the normal kit add.
  onStep?.('applying')
  if (fills.length > 0) {
    const mine = await call('GET', 'kits/mine')
    if (signedOut) return stop()
    const owned = isRecord(mine.body) && Array.isArray(mine.body.owned) ? mine.body.owned : []
    const saved = owned.find((kit) => isRecord(kit) && kit.kind === 'saved' && kit.owner === handle)
    const kitId = isRecord(saved) && typeof saved.id === 'string' ? saved.id : null
    for (const fill of fills) {
      const [author = '', slug = ''] = fill.ref.slice(1).split('/')
      let status = 0
      if (kitId) {
        try {
          status = (await addSkillToKit(kitId, author, slug)).status
        } catch {
          status = 0
        }
      }
      if (status === 401) {
        signedOut = true
        return stop()
      }
      if ((status >= 200 && status < 300) || status === 409) out.counts.fills += 1
      else if (REFUSED_FILLS.has(status)) out.notAdded.push({ name: pickName(fill.ref), reason: 'not-public' })
      else out.unadded += 1
    }
  }

  // 4. The map: every skill kept, in the job it ends up in, read and written by version.
  for (let attempt = 0; attempt < MAP_WRITES && !out.mapSaved; attempt++) {
    const read = await call('GET', 'kit-map')
    const base = read.status === 200 ? parseKitMapDocument(read.body) : null
    if (read.status !== 404 && !base) break
    const put = await call('PUT', 'kit-map', mapDocument(base, entries, derived, removed))
    if (put.status === 200) out.mapSaved = true
    else if (put.status !== 409) break
  }
  if (signedOut) return stop()

  if (out.unsent.length > 0 || out.unadded > 0 || !out.mapSaved) out.result = 'partial'
  return out
}
