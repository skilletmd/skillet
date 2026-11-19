import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  KIT_MAP_VERSION,
  type KitMapDocument,
  type KitMapEntry,
  type KitMapSaveCounts,
  type KitMapScan,
} from '@skillet/protocol/kit-map'

// Save on skillet.md (kit map onboarding, U10). The save tab proves it came from
// this map: it takes the proof only from its opener on this origin, trades it
// for a binding cookie before any sign-in, learns whether it is bound from a
// same-origin status call on every load, and approves once. A connected
// computer confirms in the frame instead, and opens no tab. Every registry
// answer here is a mocked same-origin route.

const getSessionMock = vi.hoisted(() => vi.fn())
const redirectMock = vi.hoisted(() =>
  vi.fn((href: string) => {
    throw new Error(`NEXT_REDIRECT ${href}`)
  }),
)
vi.mock('@/lib/get-session', () => ({ getSession: getSessionMock }))
vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => '/map/save',
}))
vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: () => undefined }),
}))
vi.mock('@/components/choose-username', () => ({
  ChooseUsername: () => <p>Choose a username</p>,
}))

import { SaveFlow, saveSummary } from '@/components/map/save-flow'
import type { MapSaveStatus } from '@/components/map/save-types'
import { answerSaveTab } from '@/components/map/embed-bridge'
import { KitMapView } from '@/components/map/kit-map-view'
import { MapEmbed } from '@/app/map/embed/map-embed'
import { DEMO_SCAN } from '@/app/map/embed/map-demo'
import { buildSecurityHeaders } from '@/lib/security-headers'
import { MAP_TOKEN_HEADER } from '@/app/api/map-sessions/map-session-guard'
import MapSavePage from '@/app/(consumer)/map/save/page'
import SavedMapPage from '@/app/(consumer)/map/page'

const SID = '0123456789abcdef0123456789abcdef'
const TOKEN = 'T'.repeat(43)
const PROOF = 'p'.repeat(43)
const LABEL = 'test-machine'
const COUNTS: KitMapSaveCounts = { backups: 21, removals: 2, fills: 3, merges: 1 }
const LOOPBACK = 'http://127.0.0.1:4791'
const SAVE_URL = `/map/save?s=${SID}`

const nowSec = () => Math.floor(Date.now() / 1000)
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type Session = NonNullable<MapSaveStatus['session']>
function status(session: Partial<Session> | null, over: Partial<MapSaveStatus> = {}): MapSaveStatus {
  return {
    token: TOKEN,
    bound: session?.state === 'pending',
    counts: session?.state === 'pending' ? COUNTS : null,
    session:
      session === null
        ? null
        : {
            state: 'pending',
            reason: null,
            label: LABEL,
            expiresAt: nowSec() + 600,
            approvedAt: null,
            codeDelivered: false,
            result: null,
            ...session,
          },
    ...over,
  }
}

type Leaf = 'binding' | 'bind' | 'approve'
/** The three same-origin routes, answered by `answers[leaf]`. */
function routes(answers: Partial<Record<Leaf, (init: RequestInit) => Response | MapSaveStatus>>) {
  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const match = String(input).match(/^\/api\/map-sessions\/([0-9a-f]{32})\/(binding|bind|approve)$/)
    if (!match) throw new Error(`unexpected fetch ${String(input)}`)
    const answer = answers[match[2] as Leaf]
    if (!answer) throw new Error(`no answer for ${match[2]}`)
    const out = answer(init)
    return out instanceof Response ? out : json(out)
  })
  vi.stubGlobal('fetch', mock)
  const of = (leaf: Leaf) => mock.mock.calls.filter(([input]) => String(input).endsWith(`/${leaf}`))
  return { mock, of }
}

/** The window that opened the save tab: the framed map, as postMessage sees it. */
function stubOpener(): { postMessage: MockInstance } {
  const opener = { postMessage: vi.fn() }
  Object.defineProperty(window, 'opener', { configurable: true, value: opener })
  return opener as never
}

function deliver(data: unknown, origin: string, source: unknown) {
  const event = new MessageEvent('message', { data, origin })
  Object.defineProperty(event, 'source', { value: source })
  act(() => {
    window.dispatchEvent(event)
  })
}

const signedIn = (handle: string | null = 'test-user') => ({ signedIn: true, handle })
const signedOut = { signedIn: false, handle: null }

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (window as { opener?: unknown }).opener
})

// ---------------------------------------------------------------------------
// The save tab
// ---------------------------------------------------------------------------

describe('the save tab', () => {
  it('a signed-out visit goes to login with a callback to the same address', async () => {
    routes({ binding: () => status({ state: 'pending' }) })
    const navigate = vi.fn()
    render(<SaveFlow session={SID} viewer={signedOut} usernameStep={null} navigate={navigate} />)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/login?callbackUrl=${encodeURIComponent(SAVE_URL)}`))
  })

  it('a signed-out Save that signs in with Google still approves, because the binding cookie survives the round trip', async () => {
    // First load: no binding yet, so the tab asks the map that opened it.
    let bound = false
    const api = routes({
      binding: () => (bound ? status({ state: 'pending' }) : status(null)),
      bind: () => {
        bound = true
        return json({ ok: true })
      },
      approve: () => json({ ok: true }),
    })
    const opener = stubOpener()
    const navigate = vi.fn()
    const first = render(<SaveFlow session={SID} viewer={signedOut} usernameStep={null} navigate={navigate} />)
    await waitFor(() =>
      expect(opener.postMessage).toHaveBeenCalledWith({ type: 'proof-request', v: KIT_MAP_VERSION, session: SID }, window.location.origin),
    )
    deliver({ type: 'proof', v: KIT_MAP_VERSION, session: SID, proof: PROOF, counts: COUNTS }, window.location.origin, opener)
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/login?callbackUrl=${encodeURIComponent(SAVE_URL)}`))
    const [[, bindInit]] = api.of('bind')
    expect(JSON.parse(String(bindInit!.body))).toEqual({ proof: PROOF, counts: COUNTS })
    expect(new Headers(bindInit!.headers).get(MAP_TOKEN_HEADER)).toBe(TOKEN)
    first.unmount()

    // Back from Google: the opener is gone, and only the cookie remembers the binding.
    delete (window as { opener?: unknown }).opener
    render(<SaveFlow session={SID} viewer={signedIn()} usernameStep={null} navigate={navigate} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save to @test-user' }))
    await screen.findByRole('heading', { name: `Saving on ${LABEL}` })
    const [[, approveInit]] = api.of('approve')
    expect(new Headers(approveInit!.headers).get(MAP_TOKEN_HEADER)).toBe(TOKEN)
    // The binding rides the httpOnly cookie, never the page: the body holds no secret.
    expect(String(approveInit!.body ?? '')).not.toContain(PROOF)
    expect(api.of('bind')).toHaveLength(1)
  })

  it('after a Google return, the page render sees no binding cookie, the status call reports the binding, and the tab reaches the confirm', async () => {
    getSessionMock.mockResolvedValue({ user: { name: 'Test' }, handle: 'test-user' })
    const api = routes({ binding: () => status({ state: 'pending' }) })
    const { cookies } = await import('next/headers')
    const page = await MapSavePage({ searchParams: Promise.resolve({ s: SID }) })
    render(page)
    // The server render reads no binding: the cookie is scoped to the API path and Strict.
    expect(vi.mocked(cookies)).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'Press Save in your map' })).toBeNull()
    expect(await screen.findByRole('button', { name: 'Save to @test-user' })).toBeInTheDocument()
    expect(api.of('binding')).toHaveLength(1)
  })

  it('an emailed-code return that keeps the opener uses the existing binding and never re-sends the spent proof', async () => {
    const api = routes({ binding: () => status({ state: 'pending' }) })
    const opener = stubOpener()
    render(<SaveFlow session={SID} viewer={signedIn()} usernameStep={null} navigate={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Save to @test-user' })).toBeInTheDocument()
    expect(opener.postMessage).not.toHaveBeenCalled()
    expect(api.of('bind')).toHaveLength(0)
  })

  it('a no-username 409 leaves the binding usable, and approve succeeds after the username step', async () => {
    let approve = json({ error: 'username_required' }, 409)
    const api = routes({ binding: () => status({ state: 'pending' }), approve: () => approve })
    const view = render(<SaveFlow session={SID} viewer={signedIn('stale')} usernameStep={<p>Choose a username</p>} navigate={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save to @stale' }))
    expect(await screen.findByText('Choose a username')).toBeInTheDocument()

    // The username step claims one and refreshes the page, which hands down the new handle.
    approve = json({ ok: true })
    view.rerender(<SaveFlow session={SID} viewer={signedIn('fresh')} usernameStep={<p>Choose a username</p>} navigate={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save to @fresh' }))
    await screen.findByRole('heading', { name: `Saving on ${LABEL}` })
    expect(api.of('approve')).toHaveLength(2)
  })

  it('a signed-in account with no username goes to the username step and comes back', async () => {
    routes({ binding: () => status({ state: 'pending' }) })
    const step = <p>Choose a username</p>
    const view = render(<SaveFlow session={SID} viewer={signedIn(null)} usernameStep={step} navigate={vi.fn()} />)
    expect(await screen.findByText('Choose a username')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Save to/ })).toBeNull()
    view.rerender(<SaveFlow session={SID} viewer={signedIn('new-user')} usernameStep={step} navigate={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Save to @new-user' })).toBeInTheDocument()
  })

  it('a tab opened from a link, with no opener, can not approve and says to press Save in the map', async () => {
    const api = routes({ binding: () => status(null) })
    render(<SaveFlow session={SID} viewer={signedIn()} usernameStep={null} navigate={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Press Save in your map' })).toBeInTheDocument()
    expect(screen.getByText('npx -y skilletmd map')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Save to/ })).toBeNull()
    expect(api.of('bind')).toHaveLength(0)
    expect(api.of('approve')).toHaveLength(0)
  })

  it('a tab whose opener is on another origin gets no proof and can not bind', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = routes({ binding: () => status(null), bind: () => json({ ok: true }) })
    const opener = stubOpener()
    render(<SaveFlow session={SID} viewer={signedIn()} usernameStep={null} navigate={vi.fn()} />)
    // The request names this origin as its only target, so an opener elsewhere never receives it.
    await waitFor(() => expect(opener.postMessage).toHaveBeenCalledTimes(1))
    expect(opener.postMessage.mock.calls[0]![1]).toBe(window.location.origin)
    // An answer from another origin, or from a window that isn't the opener, is ignored.
    const proof = { type: 'proof', v: KIT_MAP_VERSION, session: SID, proof: PROOF, counts: COUNTS }
    deliver(proof, 'https://evil.example', opener)
    deliver(proof, window.location.origin, { postMessage: vi.fn() })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000)
    })
    expect(await screen.findByRole('heading', { name: 'Press Save in your map' })).toBeInTheDocument()
    expect(api.of('bind')).toHaveLength(0)
  })

  it('the confirm sends one approval on a double click', async () => {
    const api = routes({ binding: () => status({ state: 'pending' }), approve: () => json({ ok: true }) })
    render(<SaveFlow session={SID} viewer={signedIn()} usernameStep={null} navigate={vi.fn()} />)
    const confirm = await screen.findByRole('button', { name: 'Save to @test-user' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await screen.findByRole('heading', { name: `Saving on ${LABEL}` })
    expect(api.of('approve')).toHaveLength(1)
  })

  it('an expired session shows the press-Save-again state', async () => {
    routes({ binding: () => status({ state: 'expired', reason: 'not-approved' }, { bound: true }) })
    render(<SaveFlow session={SID} viewer={signedIn()} usernameStep={null} navigate={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Save timed out' })).toBeInTheDocument()
    expect(screen.getByText(/Press Save in your map again\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Save to/ })).toBeNull()
  })

  it('an approval left unclaimed for 2 minutes shows the keep-the-terminal-open state, and at 5 minutes the expired state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const approvedAt = nowSec()
    let after: MapSaveStatus = status({ state: 'approved', approvedAt, codeDelivered: false })
    let approved = false
    routes({
      binding: () => (approved ? after : status({ state: 'pending' })),
      approve: () => {
        approved = true
        return json({ ok: true })
      },
    })
    render(<SaveFlow session={SID} viewer={signedIn()} usernameStep={null} navigate={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Save to @test-user' }))
    await screen.findByRole('heading', { name: `Saving on ${LABEL}` })
    expect(screen.queryByText(/Keep the terminal open/)).toBeNull()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(121_000)
    })
    expect(screen.getByText(/Keep the terminal open/)).toBeInTheDocument()

    after = status({ state: 'expired', reason: 'code-unused', approvedAt })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180_000)
    })
    expect(screen.getByRole('heading', { name: 'Save timed out' })).toBeInTheDocument()
    expect(screen.getByText(/Press Save in your map again\./)).toBeInTheDocument()
  })

  it('a session reported as applied shows the counts, the merge count with its /map link, and the app button', async () => {
    routes({
      binding: () =>
        status({
          state: 'applied',
          approvedAt: nowSec() - 60,
          codeDelivered: true,
          result: {
            result: 'applied',
            counts: { backups: 21, removals: 2, fills: 3, merges: 2 },
            notBackedUp: [{ name: 'Deploy Notes', reason: 'secret', file: '.env.local' }],
            left: null,
          },
        }),
    })
    render(<SaveFlow session={SID} viewer={signedIn()} usernameStep={null} navigate={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Saved' })).toBeInTheDocument()
    expect(screen.getByText('Backed up 21 skills privately.')).toBeInTheDocument()
    expect(screen.getByText(/Moved 2 to the trash\./)).toBeInTheDocument()
    expect(screen.getByText('npx -y skilletmd restore')).toBeInTheDocument()
    expect(screen.getByText('Added 3 picks.')).toBeInTheDocument()
    expect(screen.getByText(/Writing 2 merges/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See your map' })).toHaveAttribute('href', '/map')
    expect(screen.getByText(/Deploy Notes/)).toHaveTextContent('.env.local looks like it holds a secret')
    expect(screen.getByRole('link', { name: 'Get the app' })).toHaveAttribute('href', '/download')
  })

  it('a partial save names what is left', async () => {
    routes({
      binding: () =>
        status({
          state: 'partial',
          approvedAt: nowSec() - 60,
          codeDelivered: true,
          result: {
            result: 'partial',
            counts: { backups: 21, removals: 0, fills: 1, merges: 0 },
            left: { backups: 0, removals: 2, fills: 2, merges: 0 },
            notBackedUp: [],
          },
        }),
    })
    render(<SaveFlow session={SID} viewer={signedIn()} usernameStep={null} navigate={vi.fn()} />)
    expect(await screen.findByText(/Left to do: remove 2 skills and add 2 picks\./)).toBeInTheDocument()
  })

  it('the count summary renders above "Save to @handle" before the confirm', async () => {
    routes({ binding: () => status({ state: 'pending' }) })
    render(<SaveFlow session={SID} viewer={signedIn()} usernameStep={null} navigate={vi.fn()} />)
    const confirm = await screen.findByRole('button', { name: 'Save to @test-user' })
    expect(screen.getByRole('heading', { name: `Save from ${LABEL}` })).toBeInTheDocument()
    const summary = screen.getByText(saveSummary(COUNTS))
    expect(summary.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(saveSummary(COUNTS)).toBe(
      'Backs up 21 skills privately. Moves 2 to the trash, where you can restore them. Adds 3 picks. Writes 1 merge for you to pick from.',
    )
  })

  it('names no skill in the summary, and says plainly when there is nothing to change', () => {
    expect(saveSummary({ backups: 1, removals: 1, fills: 1, merges: 0 })).toBe(
      'Backs up 1 skill privately. Moves 1 to the trash, where you can restore it. Adds 1 pick.',
    )
    expect(saveSummary({ backups: 0, removals: 0, fills: 0, merges: 0 })).toBe('Saves your map.')
  })
})

// ---------------------------------------------------------------------------
// The frame's side
// ---------------------------------------------------------------------------

const KEY = (n: number) => `sha256:${n.toString(16).padStart(64, '0')}`
function entry(n: number, name: string, over: Partial<KitMapEntry> = {}): KitMapEntry {
  return {
    key: KEY(n),
    name,
    description: '',
    source: 'local',
    tools: [{ tool: 'claude-code', copies: 1 }],
    job: 'writing.editing',
    usage: { state: 'used', reason: null },
    ...over,
  }
}
const SCAN: KitMapScan = {
  entries: [entry(1, 'Plain Prose'), entry(2, 'Copy Editor'), entry(3, 'Deploy Notes', { job: null, noBackup: { reason: 'secret', file: '.env.local' } })],
  looked: [{ tool: 'claude-code', history: 'read' }],
  unchecked: [],
}

/** Puts the frame inside a parent window, as the loopback page does. */
function stubParent(): { postMessage: MockInstance } {
  const parent = { postMessage: vi.fn() }
  Object.defineProperty(window, 'parent', { configurable: true, value: parent })
  return parent as never
}
let realParent: PropertyDescriptor | undefined

describe("the frame's side of Save", () => {
  beforeEach(() => {
    realParent = Object.getOwnPropertyDescriptor(window, 'parent')
  })
  afterEach(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent)
  })

  it("a connected computer's Save confirms in the frame and opens no tab", () => {
    const parent = stubParent()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<MapEmbed />)
    deliver({ type: 'scan', v: KIT_MAP_VERSION, scan: { ...SCAN, connected: true } }, LOOPBACK, parent)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(open).not.toHaveBeenCalled()
    expect(parent.postMessage).toHaveBeenCalledWith({ type: 'save', v: KIT_MAP_VERSION, drafts: [] }, LOOPBACK)
    expect(screen.getByRole('button', { name: 'Checking your account…' })).toHaveAttribute('aria-disabled', 'true')

    deliver({ type: 'status', v: KIT_MAP_VERSION, state: 'confirm', handle: 'test-user' }, LOOPBACK, parent)
    const confirm = screen.getByRole('button', { name: 'Save to @test-user' })
    const summary = screen.getByText('Backs up 2 skills privately.')
    expect(summary.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    const confirms = parent.postMessage.mock.calls.filter(([message]) => (message as { type: string }).type === 'confirm')
    expect(confirms).toEqual([[{ type: 'confirm', v: KIT_MAP_VERSION }, LOOPBACK]])
    expect(open).not.toHaveBeenCalled()

    // Done is drawn by the shared component, from the frame's own counts.
    deliver({ type: 'status', v: KIT_MAP_VERSION, state: 'done' }, LOOPBACK, parent)
    fireEvent.click(screen.getByRole('button', { name: 'What changed' }))
    const done = screen.getByRole('dialog', { name: 'Saved' })
    expect(within(done).getByText('Backed up 2 skills privately.')).toBeInTheDocument()
    expect(within(done).getByText(/Deploy Notes/)).toHaveTextContent('.env.local looks like it holds a secret')
    // In the frame, links leave the map open: a new tab.
    expect(within(done).getByRole('link', { name: 'Get the app' })).toHaveAttribute('target', '_blank')
  })

  it('an unconnected Save points its tab at the session and answers only its own same-origin tab', () => {
    const parent = stubParent()
    const tab = { postMessage: vi.fn(), closed: false, focus: vi.fn(), location: { replace: vi.fn() } }
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window)
    render(<MapEmbed />)
    deliver({ type: 'scan', v: KIT_MAP_VERSION, scan: SCAN }, LOOPBACK, parent)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(open).toHaveBeenCalledWith('/map/save', 'skillet-map-save')

    deliver({ type: 'session', v: KIT_MAP_VERSION, session: SID, expiresAt: Date.now() + 600_000, proof: PROOF }, LOOPBACK, parent)
    expect(tab.location.replace).toHaveBeenCalledWith(SAVE_URL)
    // The proof never rides the URL.
    expect(JSON.stringify(tab.location.replace.mock.calls)).not.toContain(PROOF)

    const ask = { type: 'proof-request', v: KIT_MAP_VERSION, session: SID }
    deliver(ask, 'https://evil.example', tab)
    deliver(ask, window.location.origin, { postMessage: vi.fn() })
    deliver(ask, LOOPBACK, parent)
    deliver({ ...ask, session: 'f'.repeat(32) }, window.location.origin, tab)
    expect(tab.postMessage).not.toHaveBeenCalled()

    deliver(ask, window.location.origin, tab)
    expect(tab.postMessage).toHaveBeenCalledWith(
      { type: 'proof', v: KIT_MAP_VERSION, session: SID, proof: PROOF, counts: { backups: 2, removals: 0, fills: 0, merges: 0 } },
      window.location.origin,
    )
  })

  it("draws the sample scan for `?demo` off production, and in production ignores it, like the other demo pages", async () => {
    const realUrl = window.location.href
    window.history.replaceState(null, '', '/map/embed?demo')
    try {
      const { unmount } = render(<MapEmbed />)
      expect(await screen.findByText(`${DEMO_SCAN.entries.length} skills, sorted by job`)).toBeInTheDocument()
      unmount()

      vi.stubEnv('NODE_ENV', 'production')
      render(<MapEmbed />)
      // Opened with no parent: the page says where the map comes from, and no sample loads.
      expect(screen.getByRole('heading', { name: 'Sort your skills into jobs' })).toBeInTheDocument()
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      expect(screen.queryByText(/sorted by job/)).toBeNull()
    } finally {
      vi.unstubAllEnvs()
      window.history.replaceState(null, '', realUrl)
    }
  })

  it('answerSaveTab ignores everything but a proof-request from its tab on its own origin', () => {
    const tab = { postMessage: vi.fn() }
    const stop = answerSaveTab(window, {
      tab: () => tab as unknown as Window,
      answer: () => ({ session: SID, proof: PROOF, counts: COUNTS }),
    })
    deliver({ type: 'proof', v: KIT_MAP_VERSION, session: SID, proof: PROOF, counts: COUNTS }, window.location.origin, tab)
    deliver({ type: 'proof-request', v: 2, session: SID }, window.location.origin, tab)
    expect(tab.postMessage).not.toHaveBeenCalled()
    deliver({ type: 'proof-request', v: KIT_MAP_VERSION, session: SID }, window.location.origin, tab)
    expect(tab.postMessage).toHaveBeenCalledTimes(1)
    stop()
    deliver({ type: 'proof-request', v: KIT_MAP_VERSION, session: SID }, window.location.origin, tab)
    expect(tab.postMessage).toHaveBeenCalledTimes(1)
  })

  it('the frame confirm keeps the drafts locked and names the account once', () => {
    const onConfirm = vi.fn()
    render(
      <KitMapView
        scan={SCAN}
        drafts={[]}
        onDraftsChange={() => {}}
        save={{ phase: 'confirm', handle: 'test-user', sent: false }}
        onSave={() => {}}
        onReopen={() => {}}
        onConfirm={onConfirm}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save to @test-user' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    cleanup()
    render(
      <KitMapView
        scan={SCAN}
        drafts={[]}
        onDraftsChange={() => {}}
        save={{ phase: 'confirm', handle: 'test-user', sent: true }}
        onSave={() => {}}
        onReopen={() => {}}
        onConfirm={onConfirm}
      />,
    )
    const busy = screen.getByRole('button', { name: 'Saving…' })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(busy)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// The pages
// ---------------------------------------------------------------------------

describe('/map/save and /map', () => {
  it('/map/save sends X-Frame-Options: DENY and no framing, in every CSP mode', () => {
    for (const mode of ['enforce', 'report-only', 'off'] as const) {
      const headers = buildSecurityHeaders({ mode, isDev: false, pathname: '/map/save' })
      expect(headers).toContainEqual({ key: 'X-Frame-Options', value: 'DENY' })
      for (const policy of headers.filter((h) => h.key.startsWith('Content-Security-Policy'))) {
        expect(policy.value).toContain("frame-ancestors 'none'")
      }
    }
  })

  it('/map with no saved map shows the run-the-line state', async () => {
    getSessionMock.mockResolvedValue({ user: { name: 'Test' }, handle: 'test-user' })
    const { cookies } = await import('next/headers')
    vi.mocked(cookies).mockResolvedValue({ get: (name: string) => (name === 'skillet_session' ? { value: 'sess-1' } : undefined) } as never)
    const fetchMock = vi.fn(async () => json({ error: 'kit_map_not_found' }, 404))
    vi.stubGlobal('fetch', fetchMock)
    render(await SavedMapPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByRole('heading', { name: 'No saved map yet' })).toBeInTheDocument()
    expect(screen.getByText('npx -y skilletmd map')).toBeInTheDocument()
    const [[url, init]] = fetchMock.mock.calls as unknown as [[string, RequestInit]]
    expect(url).toMatch(/\/api\/v1\/kit-map$/)
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer sess-1')
  })

  it('/map draws the saved map read-only, every skill in its job', async () => {
    getSessionMock.mockResolvedValue({ user: { name: 'Test' }, handle: 'test-user' })
    const { cookies } = await import('next/headers')
    vi.mocked(cookies).mockResolvedValue({ get: (name: string) => (name === 'skillet_session' ? { value: 'sess-1' } : undefined) } as never)
    const doc: KitMapDocument = {
      version: 3,
      entries: [
        { key: KEY(1), name: 'Plain Prose', description: '', source: 'local' },
        { key: KEY(2), name: 'Copy Editor', description: '', source: 'local' },
        { key: KEY(3), name: 'Morning Brief', description: '', source: 'local' },
      ],
      assignments: { [KEY(1)]: 'writing.editing', [KEY(2)]: 'writing.editing', [KEY(3)]: null },
    }
    vi.stubGlobal('fetch', vi.fn(async () => json(doc)))
    render(await SavedMapPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByRole('heading', { name: '3 skills, sorted by job' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Writing' }))
    const sheet = screen.getByRole('dialog', { name: 'Writing' })
    expect(within(sheet).getByText('Plain Prose')).toBeInTheDocument()
    expect(within(sheet).getByText('Copy Editor')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /^(Move|Remove|Merge|Add)/ })).toBeNull()
  })

  it('/map sends a signed-out visitor to sign in and back', async () => {
    getSessionMock.mockResolvedValue(null)
    await expect(SavedMapPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      `NEXT_REDIRECT /login?callbackUrl=${encodeURIComponent('/map')}`,
    )
  })
})
