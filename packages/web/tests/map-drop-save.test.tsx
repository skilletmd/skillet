// Save from a dropped folder (kit map onboarding, U12; R3 R18 R20 R26 R27,
// KTD9 KTD11 KTD15; F3; AE6).
//
// A map built from a folder dropped on /packs/home saves from the browser. A
// signed-out Save keeps the map, its bundles and the drafts in IndexedDB
// through the login round trip. Save then backs up each kept skill by hash,
// adds picks to the account's Saved kit, records removes and merges as changes
// with no computer, for the first computer that connects and holds those
// skills, and saves the map's jobs. Every registry answer is a mocked
// same-origin proxy route, IndexedDB is an in-memory fake, and nothing reads
// the real home directory.

import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { canonicalContentHash, decodeBundle, type BundleFiles } from '@skillet/protocol'
import { HOME_PICKS } from '@/lib/packs/home-picks'
import { folderFromDrop, readSkillsFolder, type FolderRead } from '@/components/map/folder-drop'
import { KEEP_MS, forgetDrop, keepDrop, recordReads, restoreDrop, sweepDrop, type KeptDrop } from '@/lib/map-drop-store'
import { dropSaveSummary } from '@/components/map/save-flow'
import { HomeKit } from '@/components/packs/home-kit'

vi.mock('next/link', async () => {
  const react = await import('react')
  return {
    default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
      react.createElement('a', { href, ...props }, children),
  }
})
vi.mock('@/components/choose-username', () => ({ ChooseUsername: () => <p>Choose a username</p> }))

// The web session, as the username step changes it.
const auth = vi.hoisted(() => {
  let handle: string | null = null
  const subs = new Set<() => void>()
  return {
    get: () => handle,
    set(next: string | null) {
      handle = next
      for (const notify of subs) notify()
    },
    subscribe(notify: () => void) {
      subs.add(notify)
      return () => {
        subs.delete(notify)
      }
    },
  }
})
vi.mock('next-auth/react', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useSession: () => {
      const handle = useSyncExternalStore(auth.subscribe, auth.get, auth.get)
      return { data: handle ? { handle } : null, status: handle ? 'authenticated' : 'unauthenticated', update: vi.fn() }
    },
    SessionProvider: ({ children }: { children: unknown }) => children,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }
})

// ---------------------------------------------------------------------------
// IndexedDB, in memory
// ---------------------------------------------------------------------------

type Stores = Map<string, Map<IDBValidKey, unknown>>
type Handler = (() => void) | null

/** Just enough IndexedDB: open with an upgrade that can be aborted, and get, put and delete in one store. */
function fakeIndexedDB() {
  const dbs = new Map<string, { version: number; stores: Stores }>()
  const soon = (run: () => void) => setTimeout(run, 0)
  const connect = (stores: Stores) => ({
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      stores.set(name, new Map())
    },
    close: () => {},
    transaction(name: string) {
      const store = stores.get(name)
      if (!store) throw new DOMException(`No store ${name}`, 'NotFoundError')
      const tx = { oncomplete: null as Handler, onerror: null as Handler, onabort: null as Handler, error: null, objectStore: () => ops }
      const request = (run: () => unknown) => {
        const req = { result: undefined as unknown, error: null as unknown, onsuccess: null as Handler, onerror: null as Handler }
        soon(() => {
          try {
            req.result = run()
            req.onsuccess?.()
            soon(() => tx.oncomplete?.())
          } catch (err) {
            req.error = err
            req.onerror?.()
            soon(() => tx.onerror?.())
          }
        })
        return req
      }
      const ops = {
        get: (key: IDBValidKey) => request(() => (store.has(key) ? structuredClone(store.get(key)) : undefined)),
        put: (value: unknown, key: IDBValidKey) =>
          request(() => {
            store.set(key, structuredClone(value))
            return key
          }),
        delete: (key: IDBValidKey) =>
          request(() => {
            store.delete(key)
          }),
      }
      return tx
    },
  })
  const factory = {
    open(name: string, version = 1) {
      const req = {
        result: undefined as unknown,
        error: null as unknown,
        transaction: null as { abort: () => void } | null,
        onsuccess: null as Handler,
        onerror: null as Handler,
        onblocked: null as Handler,
        onupgradeneeded: null as ((event: { oldVersion: number; newVersion: number }) => void) | null,
      }
      soon(() => {
        const found = dbs.get(name)
        const stores: Stores = found ? found.stores : new Map()
        req.result = connect(stores)
        const oldVersion = found?.version ?? 0
        if (oldVersion < version) {
          let aborted = false
          req.transaction = { abort: () => (aborted = true) }
          req.onupgradeneeded?.({ oldVersion, newVersion: version })
          req.transaction = null
          if (aborted) {
            req.error = new DOMException('The upgrade was aborted.', 'AbortError')
            req.onerror?.()
            return
          }
          dbs.set(name, { version, stores })
        }
        req.onsuccess?.()
      })
      return req
    },
  }
  return { factory, dbs }
}

let idb: ReturnType<typeof fakeIndexedDB>

// ---------------------------------------------------------------------------
// A skills folder, dropped
// ---------------------------------------------------------------------------

type Tree = { [name: string]: string | Tree }
const skillMd = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n${name}.\n`

// Two Editing skills (Merge), one with files besides SKILL.md, one the jobs don't place.
const TREE: Tree = {
  'plain-prose': { 'SKILL.md': skillMd('Plain Prose', 'Edit prose so it reads plainly.') },
  'copy-editor': { 'SKILL.md': skillMd('Copy Editor', 'Edit copy for clarity and grammar.') },
  'code-review': {
    'SKILL.md': skillMd('Code Review', 'Review a pull request.'),
    'config.json': '{ "token": "placeholder" }\n',
    references: { 'checklist.md': '# Checklist\n' },
    '.DS_Store': 'not part of the skill',
  },
  'zebra-quux': { 'SKILL.md': skillMd('Zebra Quux', 'Nothing here.') },
}

const encode = (text: string) => new TextEncoder().encode(text)

/** A skill's files by the CLI's rule: dotfiles left out, at any depth. */
function bundleOf(tree: Tree, prefix = '', out = new Map<string, Uint8Array>()): Map<string, Uint8Array> {
  for (const [name, node] of Object.entries(tree)) {
    if (name.startsWith('.')) continue
    const path = prefix === '' ? name : `${prefix}/${name}`
    if (typeof node === 'string') out.set(path, encode(node))
    else bundleOf(node, path, out)
  }
  return out
}
const keyOf = (folder: string) => canonicalContentHash(bundleOf(TREE[folder] as Tree))
const KEY = {
  prose: keyOf('plain-prose'),
  copy: keyOf('copy-editor'),
  review: keyOf('code-review'),
  zebra: keyOf('zebra-quux'),
}
const hexOf = (key: string) => key.slice('sha256:'.length)

/** A dropped folder as Chrome hands it over: entries in batches, a file only on request. */
function entryOf(name: string, node: string | Tree): FileSystemEntry {
  if (typeof node === 'string') {
    const bytes = encode(node)
    return {
      isFile: true,
      isDirectory: false,
      name,
      file: (ok: (file: File) => void) =>
        queueMicrotask(() => ok({ size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer } as unknown as File)),
    } as unknown as FileSystemEntry
  }
  const children = Object.entries(node).map(([child, sub]) => entryOf(child, sub))
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let done = false
      return {
        readEntries: (ok: (batch: FileSystemEntry[]) => void) => {
          const batch = done ? [] : children
          done = true
          queueMicrotask(() => ok(batch))
        },
      }
    },
  } as unknown as FileSystemEntry
}

const dropOf = (entry: FileSystemEntry) =>
  ({ types: ['Files'], files: [], items: [{ kind: 'file', type: '', webkitGetAsEntry: () => entry }] }) as unknown as DataTransfer

// ---------------------------------------------------------------------------
// The registry, behind the same-origin proxy
// ---------------------------------------------------------------------------

const API = '/api/registry/api/v1/'
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

interface Call {
  method: string
  path: string
  // The JSON a route was sent, read loosely: each test asserts its shape.
  body: any
}
type Answer = (call: Call) => Response | Promise<Response> | undefined

interface SavedDoc {
  version: number
  entries: { key: string; name: string; description: string; source: string }[]
  assignments: Record<string, string | null>
}

/**
 * The registry routes a dropped Save calls, with state, so Try again sees
 * what the first run stored. `over` answers a route first; returning
 * undefined falls through to the default.
 */
function registry(over: Record<string, Answer> = {}) {
  const state = {
    handle: 'test-user' as string | null,
    backups: new Set<string>(),
    changes: [] as Record<string, unknown>[],
    doc: null as SavedDoc | null,
  }
  const defaults: Record<string, Answer> = {
    'GET whoami': () => json({ token_class: 'session', handle: state.handle }),
    'GET kit-map/changes': () => json({ changes: state.changes }),
    'POST kit-map/changes': ({ body }) => {
      const made = (body.changes as Record<string, unknown>[]).map((change, n) => ({
        id: `change-${state.changes.length + n + 1}`,
        device: null,
        version: 1,
        ...change,
      }))
      state.changes.push(...made)
      return json({ changes: made }, 201)
    },
    'GET backups': () => json({ backups: [...state.backups].map((hash) => ({ hash })), usage: {} }),
    'PUT backups/*': ({ path }) => {
      const hash = `sha256:${path.split('/')[1]}`
      const created = !state.backups.has(hash)
      state.backups.add(hash)
      return json({ hash, created }, created ? 201 : 200)
    },
    'GET kits/mine': () =>
      json({
        owned: [
          { id: 'kit-other', owner: 'test-user', kind: 'custom', name: 'Other', slug: 'other', skills: [] },
          { id: 'kit-saved', owner: 'test-user', kind: 'saved', name: 'Saved', slug: 'saved', skills: [] },
        ],
        member: [],
        subscribed: [],
        author_kits: [],
      }),
    'POST kits/*/skills': () => json({ ok: true }),
    'GET kit-map': () => (state.doc ? json(state.doc) : json({ error: 'kit_map_not_found' }, 404)),
    'PUT kit-map': ({ body }) => {
      if ((state.doc?.version ?? 0) !== body.version) return json({ error: 'version_conflict' }, 409)
      state.doc = { ...body, version: body.version + 1 }
      return json({ version: body.version + 1 })
    },
  }
  const calls: Call[] = []
  const matches = (route: string, method: string, path: string) => {
    const [want, pattern] = route.split(' ')
    const parts = pattern!.split('/')
    const got = path.split('/')
    return want === method && parts.length === got.length && parts.every((part, n) => part === '*' || part === got[n])
  }
  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (!url.startsWith(API)) throw new Error(`unexpected fetch ${url}`)
    const call: Call = {
      method: (init.method ?? 'GET').toUpperCase(),
      path: url.slice(API.length),
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    }
    calls.push(call)
    for (const answers of [over, defaults]) {
      const route = Object.keys(answers).find((key) => matches(key, call.method, call.path))
      const answer = route ? await answers[route]!(call) : undefined
      if (answer) return answer
    }
    throw new Error(`no answer for ${call.method} ${call.path}`)
  })
  vi.stubGlobal('fetch', mock)
  const of = (route: string) => calls.filter((call) => matches(route, call.method, call.path))
  return { state, calls, of }
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const KEPT_URL = '/packs/home?drop=kept'
const LOGIN_BACK = `/login?callbackUrl=${encodeURIComponent(KEPT_URL)}`
const PICK = HOME_PICKS['sales.prospecting'][0]!

function page() {
  const navigate = vi.fn<(href: string) => void>()
  render(<HomeKit navigate={navigate} />)
  return navigate
}

async function dropTree() {
  fireEvent.drop(screen.getByRole('region', { name: 'Drop your skills folder here' }), {
    dataTransfer: dropOf(entryOf('skills', TREE)),
  })
  await screen.findByRole('heading', { level: 1, name: '4 skills, sorted by job' })
}

/** Opens a section's sheet, acts in it, and closes it. */
function inSheet(section: string, act: (sheet: HTMLElement) => void) {
  fireEvent.click(screen.getByRole('button', { name: section }))
  const sheet = screen.getByRole('dialog', { name: section })
  act(sheet)
  const open = screen.queryByRole('dialog', { name: section })
  if (open) fireEvent.click(within(open).getByRole('button', { name: 'Close' }))
}

const draftRemoveZebra = () => inSheet('Not sorted', (sheet) => fireEvent.click(within(sheet).getByRole('button', { name: 'Remove Zebra Quux' })))
const draftMergeEditing = () => inSheet('Writing', (sheet) => fireEvent.click(within(sheet).getByRole('button', { name: 'Merge 2 Editing skills' })))
const draftFillProspecting = () =>
  inSheet('Sales', (sheet) => fireEvent.click(within(sheet).getByRole('button', { name: `Add ${PICK.name} to Prospecting` })))
function draftMoveZebraToEditing() {
  fireEvent.click(screen.getByRole('button', { name: 'Not sorted' }))
  const sheet = screen.getByRole('dialog', { name: 'Not sorted' })
  fireEvent.click(within(sheet).getByRole('button', { name: 'Move Zebra Quux' }))
  const picker = screen.getByRole('dialog', { name: 'Move Zebra Quux' })
  fireEvent.click(within(picker).getByRole('button', { name: 'Editing' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
}

/** Save, then the confirm that names the account. */
async function saveAndConfirm(handle = 'test-user') {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  fireEvent.click(await screen.findByRole('button', { name: `Save to @${handle}` }))
}

beforeEach(() => {
  idb = fakeIndexedDB()
  vi.stubGlobal('indexedDB', idb.factory)
  auth.set(null)
  window.history.replaceState(null, '', '/packs/home')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/')
})

// ---------------------------------------------------------------------------
// What the drop keeps for Save
// ---------------------------------------------------------------------------

describe('the bytes a dropped map was keyed from', () => {
  it('keeps each skill read, by its key, with the same files the key covers', async () => {
    const recorder = recordReads(folderFromDrop(dropOf(entryOf('skills', TREE)))!)
    const read: FolderRead = await readSkillsFolder(recorder.root)
    if (read.kind !== 'map') throw new Error(`expected a map, got ${read.kind}`)
    expect(read.scan.entries.map((e) => e.key).sort()).toEqual(Object.values(KEY).sort())

    const bundles = await recorder.bundles([KEY.prose, KEY.review])
    expect([...bundles.keys()].sort()).toEqual([KEY.prose, KEY.review].sort())
    const review = bundles.get(KEY.review)!
    expect([...review.keys()].sort()).toEqual(['SKILL.md', 'config.json', 'references/checklist.md'])
    expect(canonicalContentHash(new Map(review))).toBe(KEY.review)
    expect(canonicalContentHash(new Map(bundles.get(KEY.prose)!))).toBe(KEY.prose)
  })
})

describe('the map kept through sign-in', () => {
  const kept = async (): Promise<KeptDrop> => {
    const recorder = recordReads(folderFromDrop(dropOf(entryOf('skills', TREE)))!)
    const read = await readSkillsFolder(recorder.root)
    if (read.kind !== 'map') throw new Error('expected a map')
    return {
      scan: read.scan,
      missed: 0,
      drafts: [{ kind: 'remove', key: KEY.zebra }],
      bundles: await recorder.bundles(read.scan.entries.map((e) => e.key)),
    }
  }

  it('keeps the map, its bundles and the drafts, and gives them back', async () => {
    const drop = await kept()
    await expect(keepDrop(drop)).resolves.toBe(true)
    const back = await restoreDrop()
    expect(back?.scan).toEqual(drop.scan)
    expect(back?.drafts).toEqual([{ kind: 'remove', key: KEY.zebra }])
    expect(canonicalContentHash(new Map(back!.bundles.get(KEY.review)!))).toBe(KEY.review)
    await forgetDrop()
    await expect(restoreDrop()).resolves.toBeNull()
  })

  it('forgets a map kept more than 24 hours ago', async () => {
    const now = Date.now()
    await keepDrop(await kept(), now - KEEP_MS - 1_000)
    await expect(restoreDrop(now)).resolves.toBeNull()
    // Gone, not just skipped.
    await expect(restoreDrop(now - KEEP_MS)).resolves.toBeNull()
  })

  it('a sweep clears an old map and leaves a fresh one', async () => {
    const now = Date.now()
    await keepDrop(await kept(), now - 1_000)
    await sweepDrop(now)
    expect(await restoreDrop(now)).not.toBeNull()
    await sweepDrop(now + KEEP_MS)
    expect(await restoreDrop(now)).toBeNull()
  })

  it('a sweep or a restore with nothing kept leaves no database behind', async () => {
    await sweepDrop()
    await expect(restoreDrop()).resolves.toBeNull()
    expect(idb.dbs.size).toBe(0)
  })

  it('says it kept nothing when IndexedDB is not there', async () => {
    const drop = await kept()
    vi.stubGlobal('indexedDB', undefined)
    await expect(keepDrop(drop)).resolves.toBe(false)
    await expect(restoreDrop()).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Save on a dropped map
// ---------------------------------------------------------------------------

describe('Save on a dropped map', () => {
  it('sends nothing anywhere while the person drafts', async () => {
    const api = registry()
    page()
    await dropTree()
    draftRemoveZebra()
    draftMergeEditing()
    expect(api.calls).toEqual([])
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('a signed-out Save keeps the map through the login round trip', async () => {
    const api = registry({ 'GET whoami': () => json({ error: 'auth_required' }, 401) })
    const navigate = page()
    await dropTree()
    draftRemoveZebra()
    draftFillProspecting()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(LOGIN_BACK))
    expect(screen.getByRole('button', { name: 'Taking you to sign in…' })).toHaveAttribute('aria-disabled', 'true')
    // Nothing about the skills reached Skillet before sign-in.
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET whoami'])
    cleanup()

    // Back from sign-in, signed in: the same map, the same drafts, and the confirm.
    window.history.replaceState(null, '', KEPT_URL)
    registry()
    page()
    expect(await screen.findByRole('heading', { level: 1, name: '4 skills, sorted by job' })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Save to @test-user' })).toBeInTheDocument()
    expect(screen.getByText('Backs up 3 skills privately. Adds 1 pick. Leaves 1 removal for the app.')).toBeInTheDocument()
  })

  it('after Save, the removes and merges wait for the app, stored with no device (AE6)', async () => {
    const api = registry()
    page()
    await dropTree()
    draftRemoveZebra()
    draftMergeEditing()
    await saveAndConfirm()
    expect(await screen.findByText('Saved. Backed up 3 skills. 2 changes wait for the app.')).toBeInTheDocument()

    const [record] = api.of('POST kit-map/changes')
    expect(record!.body).toEqual({
      changes: [
        { kind: 'remove', key: KEY.zebra },
        // In map order: by name.
        { kind: 'merge', job: 'writing.editing', keys: [KEY.copy, KEY.prose] },
      ],
    })
    // No computer named: the first one that connects and holds these skills claims them.
    expect(record!.body.changes.some((change: object) => 'device' in change)).toBe(false)
    // A removed skill isn't backed up from here; the app backs it up before it moves it.
    expect(api.of('PUT backups/*').map((c) => c.path)).not.toContain(`backups/${hexOf(KEY.zebra)}`)
    // It stays on the saved map, where the folder had it, until a computer
    // removes it: the app claims a change with no computer by the hashes the saved map holds.
    const doc = api.state.doc!
    expect(doc.entries.map((e) => e.name).sort()).toEqual(['Code Review', 'Copy Editor', 'Plain Prose', 'Zebra Quux'])
    expect(doc.assignments).toHaveProperty([KEY.zebra], null)

    fireEvent.click(screen.getByRole('button', { name: 'What changed' }))
    const done = screen.getByRole('dialog', { name: 'Saved' })
    expect(within(done).getByText('Backed up 3 skills privately.')).toBeInTheDocument()
    expect(within(done).getByText('1 removal and 1 merge wait for the app.')).toBeInTheDocument()
    expect(within(done).getByText('The app makes the waiting changes on the computer these skills came from.')).toBeInTheDocument()
    // The app, in one button (R26).
    expect(within(done).getByRole('link', { name: 'Get the app' })).toHaveAttribute('href', '/download')
    expect(screen.getAllByRole('link', { name: 'Get the app' }).length).toBeGreaterThan(0)
  })

  it('backs up each kept skill by hash, adds picks to the Saved kit, and saves the jobs with the moves', async () => {
    const api = registry()
    api.state.backups.add(KEY.copy)
    api.state.doc = {
      version: 4,
      entries: [{ key: `sha256:${'f'.repeat(64)}`, name: 'From Another Computer', description: '', source: 'local' }],
      assignments: { [`sha256:${'f'.repeat(64)}`]: 'business.meetings' },
    }
    page()
    await dropTree()
    draftMoveZebraToEditing()
    draftFillProspecting()
    await saveAndConfirm()
    expect(await screen.findByText('Saved. Backed up 4 skills.')).toBeInTheDocument()

    // By hash, skipping what the account holds, with the exact bytes the key covers.
    const puts = api.of('PUT backups/*')
    expect(puts.map((c) => c.path).sort()).toEqual([KEY.prose, KEY.review, KEY.zebra].map((k) => `backups/${hexOf(k)}`).sort())
    for (const put of puts) {
      const key = `sha256:${put.path.split('/')[1]}`
      expect(canonicalContentHash(decodeBundle(put.body.files as BundleFiles))).toBe(key)
      expect(put.body).toMatchObject({ tools: [], origin: 'drop' })
    }
    expect(puts.find((c) => c.path.endsWith(hexOf(KEY.review)))!.body).toMatchObject({ name: 'Code Review', description: 'Review a pull request.' })

    // The pick goes into the account's Saved kit, the normal kit add.
    expect(api.of('POST kits/*/skills').map((c) => [c.path, c.body])).toEqual([
      ['kits/kit-saved/skills', { author: PICK.handle, slug: PICK.slug }],
    ])

    // The saved map keeps the other computer's skills, adds these, and holds the move.
    const doc = api.state.doc!
    expect(doc.version).toBe(5)
    expect(doc.entries.map((e) => e.name).sort()).toEqual(['Code Review', 'Copy Editor', 'From Another Computer', 'Plain Prose', 'Zebra Quux'])
    expect(doc.assignments[KEY.zebra]).toBe('writing.editing')
    expect(doc.assignments[KEY.review]).toBe('development.code-review')
    expect(doc.assignments[`sha256:${'f'.repeat(64)}`]).toBe('business.meetings')
    for (const entry of doc.entries) expect(Object.keys(entry).sort()).toEqual(['description', 'key', 'name', 'source'])
    // No removes or merges were drafted, so none were recorded.
    expect(api.of('POST kit-map/changes')).toEqual([])
  })

  it('a skill drafted for removal keeps the job saved before, until a computer removes it', async () => {
    const api = registry()
    api.state.doc = {
      version: 2,
      entries: [{ key: KEY.zebra, name: 'Zebra Quux', description: 'Nothing here.', source: 'local' }],
      assignments: { [KEY.zebra]: 'business.meetings' },
    }
    page()
    await dropTree()
    draftRemoveZebra()
    await saveAndConfirm()
    expect(await screen.findByText('Saved. Backed up 3 skills. 1 change waits for the app.')).toBeInTheDocument()

    expect(api.state.changes).toEqual([expect.objectContaining({ kind: 'remove', key: KEY.zebra, device: null })])
    const doc = api.state.doc!
    expect(doc.version).toBe(3)
    expect(doc.entries.map((e) => e.key)).toContain(KEY.zebra)
    expect(doc.assignments[KEY.zebra]).toBe('business.meetings')
  })

  it('re-reads the saved map when someone wrote it first', async () => {
    let first = true
    const api = registry({
      'PUT kit-map': () => {
        if (!first) return undefined
        first = false
        api.state.doc = { version: 7, entries: [], assignments: {} }
        return json({ error: 'version_conflict' }, 409)
      },
    })
    page()
    await dropTree()
    await saveAndConfirm()
    expect(await screen.findByText('Saved. Backed up 4 skills.')).toBeInTheDocument()
    expect(api.of('PUT kit-map').map((c) => c.body.version)).toEqual([0, 7])
  })

  it('one failed backup names that skill and keeps the rest; Try again sends only it', async () => {
    let down = true
    const api = registry({
      [`PUT backups/${hexOf(KEY.review)}`]: () => (down ? json({ error: 'unavailable' }, 503) : undefined),
    })
    page()
    await dropTree()
    draftRemoveZebra()
    draftFillProspecting()
    await saveAndConfirm()
    expect(await screen.findByText('Saved partway. Left to do: back up 1 skill.')).toBeInTheDocument()
    // The rest went through.
    expect(api.state.backups).toEqual(new Set([KEY.prose, KEY.copy]))
    expect(api.of('POST kits/*/skills')).toHaveLength(1)
    expect(api.state.changes).toHaveLength(1)
    expect(api.state.doc).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'What changed' }))
    const done = screen.getByRole('dialog', { name: 'Saved partway' })
    expect(within(done).getByText('Backed up 2 skills privately.')).toBeInTheDocument()
    expect(within(done).getByText("Code Review didn't back up. Try again.")).toBeInTheDocument()
    fireEvent.click(within(done).getByRole('button', { name: 'Close' }))

    down = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Saved. Backed up 3 skills. 1 change waits for the app.')).toBeInTheDocument()
    const sent = api.of('PUT backups/*').map((c) => c.path)
    expect(sent.filter((p) => p.endsWith(hexOf(KEY.review)))).toHaveLength(2)
    expect(sent.filter((p) => p.endsWith(hexOf(KEY.prose)))).toHaveLength(1)
    // The remove was recorded once.
    expect(api.of('POST kit-map/changes')).toHaveLength(1)
    expect(api.state.changes).toHaveLength(1)
  })

  it('a skill refused for a secret is listed with the file and line to clean', async () => {
    registry({
      [`PUT backups/${hexOf(KEY.review)}`]: () =>
        json(
          {
            error: 'scan_blocked',
            reason: 'secret',
            status: 'quarantined',
            findings: [{ category: 'secret', confidence: 'high', file: 'config.json', lineStart: 3, lineEnd: 3, why: 'A token.' }],
          },
          422,
        ),
    })
    page()
    await dropTree()
    await saveAndConfirm()
    expect(await screen.findByText("Saved. Backed up 3 skills. 1 skill isn't backed up.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'What changed' }))
    const done = screen.getByRole('dialog', { name: 'Saved' })
    expect(within(done).getByText("Code Review isn't backed up: config.json looks like it holds a secret on line 3.")).toBeInTheDocument()
  })

  it('a skill the folder read flagged is listed with why it is not backed up, and is never sent', async () => {
    const api = registry()
    page()
    const tree: Tree = {
      ...TREE,
      vendored: { 'SKILL.md': skillMd('Vendored Thing', 'Nothing here either.'), '.git': { HEAD: 'ref: refs/heads/main\n' } },
    }
    fireEvent.drop(screen.getByRole('region', { name: 'Drop your skills folder here' }), { dataTransfer: dropOf(entryOf('skills', tree)) })
    await screen.findByRole('heading', { level: 1, name: '5 skills, sorted by job' })
    await saveAndConfirm()
    expect(await screen.findByText("Saved. Backed up 4 skills. 1 skill isn't backed up.")).toBeInTheDocument()
    expect(api.of('PUT backups/*')).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'What changed' }))
    const done = screen.getByRole('dialog', { name: 'Saved' })
    expect(within(done).getByText("Vendored Thing isn't backed up: it holds a .git folder.")).toBeInTheDocument()
  })

  it('with IndexedDB unavailable, a signed-in Save still works', async () => {
    vi.stubGlobal('indexedDB', undefined)
    registry()
    page()
    await dropTree()
    await saveAndConfirm()
    expect(await screen.findByText('Saved. Backed up 4 skills.')).toBeInTheDocument()
  })

  it('with IndexedDB unavailable, a signed-out Save asks the person to sign in first', async () => {
    vi.stubGlobal('indexedDB', undefined)
    const api = registry({ 'GET whoami': () => json({ error: 'auth_required' }, 401) })
    const navigate = page()
    await dropTree()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(/Sign in first, then drop your folder again\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', `/login?callbackUrl=${encodeURIComponent('/packs/home')}`)
    expect(navigate).not.toHaveBeenCalled()
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET whoami'])
  })

  it('an account with no username picks one, then confirms', async () => {
    const api = registry()
    api.state.handle = null
    page()
    await dropTree()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    const step = await screen.findByRole('dialog', { name: 'Save your map' })
    expect(await within(step).findByText('Choose a username')).toBeInTheDocument()
    act(() => auth.set('new-user'))
    expect(await screen.findByRole('button', { name: 'Save to @new-user' })).toBeInTheDocument()
  })

  it("says so when Skillet can't be reached, and saves nothing", async () => {
    const api = registry({ 'GET whoami': () => json({ error: 'registry_unreachable' }, 502) })
    page()
    await dropTree()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText("Couldn't reach Skillet. Nothing was saved.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(api.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET whoami'])
  })

  it('clears the kept map once Save finishes', async () => {
    registry({ 'GET whoami': () => json({ error: 'auth_required' }, 401) })
    page()
    await dropTree()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Taking you to sign in…' })
    expect(await restoreDrop()).not.toBeNull()
    cleanup()

    window.history.replaceState(null, '', KEPT_URL)
    registry()
    page()
    fireEvent.click(await screen.findByRole('button', { name: 'Save to @test-user' }))
    expect(await screen.findByText('Saved. Backed up 4 skills.')).toBeInTheDocument()
    await waitFor(async () => expect(await restoreDrop()).toBeNull())
    expect(window.location.search).toBe('')
  })

  it('a map kept past 24 hours does not come back, and says to drop the folder again', async () => {
    const recorder = recordReads(folderFromDrop(dropOf(entryOf('skills', TREE)))!)
    const read = await readSkillsFolder(recorder.root)
    if (read.kind !== 'map') throw new Error('expected a map')
    await keepDrop({ scan: read.scan, missed: 0, drafts: [], bundles: await recorder.bundles([KEY.prose]) }, Date.now() - KEEP_MS - 1_000)
    window.history.replaceState(null, '', KEPT_URL)
    const api = registry()
    page()
    const zone = screen.getByRole('region', { name: 'Drop your skills folder here' })
    expect(await within(zone).findByText("Couldn't bring your map back. Drop your folder again to save it.")).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'A skill for every job' })).toBeInTheDocument()
    expect(api.calls).toEqual([])
    expect(await restoreDrop()).toBeNull()
  })

  it('Start over forgets a kept map', async () => {
    registry({ 'GET whoami': () => json({ error: 'auth_required' }, 401) })
    page()
    await dropTree()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Taking you to sign in…' })
    cleanup()

    window.history.replaceState(null, '', KEPT_URL)
    registry()
    page()
    await screen.findByRole('button', { name: 'Save to @test-user' })
    fireEvent.click(screen.getByRole('button', { name: 'Start over' }))
    expect(screen.getByRole('heading', { level: 1, name: 'A skill for every job' })).toBeInTheDocument()
    await waitFor(async () => expect(await restoreDrop()).toBeNull())
  })

  it('the confirm says what Save does from here: backups and picks now, removes and merges for the app', () => {
    expect(dropSaveSummary({ backups: 3, removals: 2, fills: 1, merges: 1 })).toBe(
      'Backs up 3 skills privately. Adds 1 pick. Leaves 2 removals and 1 merge for the app.',
    )
    expect(dropSaveSummary({ backups: 1, removals: 0, fills: 0, merges: 0 })).toBe('Backs up 1 skill privately.')
    expect(dropSaveSummary({ backups: 0, removals: 0, fills: 0, merges: 0 })).toBe('Saves your map.')
  })
})
