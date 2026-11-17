import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { KIT_MAP_VERSION, type KitMapScan } from '@skillet/protocol/kit-map'
import { isLoopbackOrigin, openEmbedBridge, type EmbedBridgeEvents } from '@/components/map/embed-bridge'

// The frame (skillet.md/map/embed) takes the scan from the page `skillet map`
// serves on 127.0.0.1, and from nowhere else. These run the bridge inside a
// real jsdom iframe, so `window.parent` is the test window, as it is for the
// framed page.

const LOOPBACK = 'http://127.0.0.1:4791'
const KEY_A = `sha256:${'a'.repeat(64)}`

const SCAN: KitMapScan = {
  entries: [
    {
      key: KEY_A,
      name: 'Plain Prose',
      description: 'Rewrite copy so it reads plainly.',
      source: 'local',
      tools: [{ tool: 'claude-code', copies: 1 }],
      job: 'writing.editing',
      usage: { state: 'used', reason: null },
    },
  ],
  looked: [{ tool: 'claude-code', history: 'read' }],
  unchecked: [],
}

const scanMessage = (scan: KitMapScan = SCAN) => ({ type: 'scan', v: KIT_MAP_VERSION, scan })

/**
 * A real iframe, so the bridge's `window.parent` is a real window. The spy sits
 * on that parent object itself: vitest's global `window` is a copy of jsdom's
 * window with bound methods, so spying there never sees the frame's calls.
 */
function framed(): Window {
  const iframe = document.createElement('iframe')
  document.body.append(iframe)
  const child = iframe.contentWindow!
  parentPost = vi.spyOn(child.parent, 'postMessage').mockImplementation(() => {})
  return child
}

let parentPost: MockInstance

/** A message as the browser hands it to the frame: who sent it, from which origin. */
function deliver(child: Window, data: unknown, origin: string, source: unknown = child.parent): void {
  const Ctor = (child as unknown as typeof globalThis).MessageEvent
  const event = new Ctor('message', { data, origin })
  Object.defineProperty(event, 'source', { value: source })
  child.dispatchEvent(event)
}

function events(): EmbedBridgeEvents & { [K in keyof EmbedBridgeEvents]: MockInstance } {
  return { scan: vi.fn(), session: vi.fn(), status: vi.fn(), mismatch: vi.fn() } as never
}

describe('isLoopbackOrigin', () => {
  it('accepts the loopback page skillet map serves', () => {
    for (const origin of ['http://127.0.0.1:4791', 'http://localhost:4791', 'http://127.0.0.1:1', 'http://localhost:65535']) {
      expect(isLoopbackOrigin(origin), origin).toBe(true)
    }
  })

  it('refuses anything else, lookalikes included', () => {
    for (const origin of [
      'https://evil.example',
      'https://127.0.0.1:4791',
      'http://127.0.0.1',
      'http://127.0.0.1:0',
      'http://127.0.0.1:65536',
      'http://127.0.0.1:04791',
      'http://127.0.0.1.evil.example:4791',
      'http://localhost.evil.example:4791',
      'http://[::1]:4791',
      'null',
      '',
    ]) {
      expect(isLoopbackOrigin(origin), origin).toBe(false)
    }
  })
})

describe('the embed bridge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('says ready to its parent, and nothing more until a scan pins an origin', () => {
    const child = framed()
    const bridge = openEmbedBridge(child, events())
    const post = parentPost
    expect(post).toHaveBeenCalledTimes(1)
    expect(post).toHaveBeenCalledWith({ type: 'ready', v: KIT_MAP_VERSION }, '*')

    bridge.drafts([{ kind: 'remove', key: KEY_A }])
    bridge.save([{ kind: 'remove', key: KEY_A }])
    expect(post).toHaveBeenCalledTimes(1)
    expect(bridge.origin()).toBeNull()
    bridge.close()
  })

  it('takes a scan from its loopback parent and pins that exact origin', () => {
    const child = framed()
    const on = events()
    const bridge = openEmbedBridge(child, on)
    deliver(child, scanMessage(), LOOPBACK)
    expect(on.scan).toHaveBeenCalledTimes(1)
    expect(on.scan).toHaveBeenCalledWith(SCAN)
    expect(bridge.origin()).toBe(LOOPBACK)
    bridge.close()
  })

  it('ignores a scan from https://evil.example', () => {
    const child = framed()
    const on = events()
    const bridge = openEmbedBridge(child, on)
    deliver(child, scanMessage(), 'https://evil.example')
    expect(on.scan).not.toHaveBeenCalled()
    expect(bridge.origin()).toBeNull()
    bridge.close()
  })

  it('ignores a loopback scan that does not come from its parent window', () => {
    const child = framed()
    const on = events()
    const bridge = openEmbedBridge(child, on)
    const sibling = framed()
    deliver(child, scanMessage(), LOOPBACK, sibling)
    deliver(child, scanMessage(), LOOPBACK, null)
    expect(on.scan).not.toHaveBeenCalled()
    bridge.close()
  })

  it('after the first scan, ignores a message from a different loopback port', () => {
    const child = framed()
    const on = events()
    const bridge = openEmbedBridge(child, on)
    deliver(child, scanMessage(), LOOPBACK)
    deliver(child, scanMessage(), 'http://127.0.0.1:5555')
    deliver(child, { type: 'status', v: KIT_MAP_VERSION, state: 'ended' }, 'http://127.0.0.1:5555')
    deliver(child, { type: 'session', v: KIT_MAP_VERSION, session: 'map_1', expiresAt: 1 }, 'http://localhost:4791')
    expect(on.scan).toHaveBeenCalledTimes(1)
    expect(on.status).not.toHaveBeenCalled()
    expect(on.session).not.toHaveBeenCalled()
    expect(bridge.origin()).toBe(LOOPBACK)

    deliver(child, { type: 'status', v: KIT_MAP_VERSION, state: 'ended' }, LOOPBACK)
    expect(on.status).toHaveBeenCalledWith({ type: 'status', v: KIT_MAP_VERSION, state: 'ended' })
    bridge.close()
  })

  it('drops session and status that arrive before any scan', () => {
    const child = framed()
    const on = events()
    const bridge = openEmbedBridge(child, on)
    deliver(child, { type: 'status', v: KIT_MAP_VERSION, state: 'saving' }, LOOPBACK)
    deliver(child, { type: 'session', v: KIT_MAP_VERSION, session: 'map_1', expiresAt: 1 }, LOOPBACK)
    expect(on.status).not.toHaveBeenCalled()
    expect(on.session).not.toHaveBeenCalled()
    bridge.close()
  })

  it('answers only to the pinned origin', () => {
    const child = framed()
    const bridge = openEmbedBridge(child, events())
    deliver(child, scanMessage(), LOOPBACK)
    const post = parentPost
    post.mockClear()

    bridge.drafts([{ kind: 'remove', key: KEY_A }])
    bridge.save([{ kind: 'move', key: KEY_A, job: 'writing.docs' }])
    expect(post).toHaveBeenNthCalledWith(1, { type: 'drafts', v: KIT_MAP_VERSION, drafts: [{ kind: 'remove', key: KEY_A }] }, LOOPBACK)
    expect(post).toHaveBeenNthCalledWith(
      2,
      { type: 'save', v: KIT_MAP_VERSION, drafts: [{ kind: 'move', key: KEY_A, job: 'writing.docs' }] },
      LOOPBACK,
    )
    for (const call of post.mock.calls) expect(call[1]).toBe(LOOPBACK)
    bridge.close()
  })

  it('drops a malformed scan, and reports a message from another version', () => {
    const child = framed()
    const on = events()
    const bridge = openEmbedBridge(child, on)
    deliver(child, { type: 'scan', v: KIT_MAP_VERSION, scan: { entries: 'nope', looked: [], unchecked: [] } }, LOOPBACK)
    deliver(child, { ...scanMessage(), path: '/Users/test-machine/.claude/skills' }, LOOPBACK)
    expect(on.scan).not.toHaveBeenCalled()
    expect(on.mismatch).not.toHaveBeenCalled()

    deliver(child, { type: 'scan', v: 2, scan: SCAN }, LOOPBACK)
    expect(on.scan).not.toHaveBeenCalled()
    expect(on.mismatch).toHaveBeenCalledWith(2)

    // A newer message from a page that isn't the loopback parent says nothing.
    deliver(child, { type: 'scan', v: 3, scan: SCAN }, 'https://evil.example')
    expect(on.mismatch).toHaveBeenCalledTimes(1)
    bridge.close()
  })

  it('ignores the messages only the frame and the save tab send', () => {
    const child = framed()
    const on = events()
    const bridge = openEmbedBridge(child, on)
    deliver(child, scanMessage(), LOOPBACK)
    for (const data of [
      { type: 'ready', v: KIT_MAP_VERSION },
      { type: 'drafts', v: KIT_MAP_VERSION, drafts: [] },
      { type: 'save', v: KIT_MAP_VERSION, drafts: [] },
      { type: 'proof-request', v: KIT_MAP_VERSION, session: 'map_1' },
    ]) {
      deliver(child, data, LOOPBACK)
    }
    expect(on.scan).toHaveBeenCalledTimes(1)
    expect(on.session).not.toHaveBeenCalled()
    expect(on.status).not.toHaveBeenCalled()
    bridge.close()
  })

  it('keeps the scan in memory: no storage, no history, no request', () => {
    const child = framed()
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const xhr = vi.spyOn(XMLHttpRequest.prototype, 'open')
    const writes = [
      vi.spyOn(window.localStorage, 'setItem'),
      vi.spyOn(window.sessionStorage, 'setItem'),
      vi.spyOn(child.localStorage, 'setItem'),
      vi.spyOn(child.sessionStorage, 'setItem'),
      vi.spyOn(child.history, 'pushState'),
      vi.spyOn(child.history, 'replaceState'),
      vi.spyOn(window.history, 'pushState'),
      vi.spyOn(window.history, 'replaceState'),
    ]
    const href = child.location.href

    const bridge = openEmbedBridge(child, events())
    deliver(child, scanMessage(), LOOPBACK)
    bridge.drafts([{ kind: 'remove', key: KEY_A }])

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhr).not.toHaveBeenCalled()
    for (const write of writes) expect(write).not.toHaveBeenCalled()
    expect(child.location.href).toBe(href)
    expect(child.document.cookie).toBe('')
    bridge.close()
  })

  it('stops listening once closed', () => {
    const child = framed()
    const on = events()
    const bridge = openEmbedBridge(child, on)
    bridge.close()
    deliver(child, scanMessage(), LOOPBACK)
    expect(on.scan).not.toHaveBeenCalled()
  })
})
