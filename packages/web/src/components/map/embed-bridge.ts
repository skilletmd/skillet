/**
 * The framed map's side of the postMessage bridge. `skillet map` serves a page
 * on the person's computer (the loopback page) that frames skillet.md/map/embed
 * and hands it the scan. This module is the only way anything reaches the
 * frame from outside:
 *
 * - It takes `scan`, `session` and `status` only from `window.parent`, and only
 *   from a loopback origin. The first good `scan` pins that exact origin, and
 *   from then on a message from any other origin (another port included) is
 *   dropped.
 * - It answers only to the pinned origin. `ready` is the one exception: it goes
 *   out before any origin is known, so it carries nothing but its type.
 * - The scan stays in memory. Nothing here writes storage, history, cookies or
 *   the URL, and nothing makes a request: the embed's CSP blocks every
 *   connection anyway (`connect-src 'none'`), and this keeps the bridge from
 *   ever trying.
 * - The save tab (skillet.md/map/save, opened by Save) is the one other window
 *   the frame talks to, and only to answer its `proof-request`: see
 *   `answerSaveTab`.
 *
 * Node-free: imports only the `@skillet/protocol/kit-map` subpath.
 */

import {
  KIT_MAP_VERSION,
  kitMapMessageVersion,
  parseKitMapMessage,
  type KitMapDraft,
  type KitMapEntry,
  type KitMapSaveCounts,
  type KitMapScan,
  type KitMapSessionMessage,
  type KitMapStatusMessage,
} from '@skillet/protocol/kit-map'

// http only: the CLI serves plain http on 127.0.0.1. A port is required and has
// no leading zero, so the origin string is exactly what the browser reports.
const LOOPBACK_ORIGIN_RE = /^http:\/\/(?:127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$/

/** `http://127.0.0.1:<port>` or `http://localhost:<port>`: the hosts the embed's frame-ancestors allows. */
export function isLoopbackOrigin(origin: string): boolean {
  const match = LOOPBACK_ORIGIN_RE.exec(origin)
  return match !== null && Number(match[1]) <= 65_535
}

export interface EmbedBridgeEvents {
  /** A scan to draw: the first one pins the loopback origin, later ones replace it. */
  scan: (scan: KitMapScan) => void
  /** The map session Save opened, for the save tab. */
  session: (message: KitMapSessionMessage) => void
  status: (message: KitMapStatusMessage) => void
  /** The loopback page speaks another version of the bridge, so it needs updating. */
  mismatch: (version: number) => void
}

export interface EmbedBridge {
  /** The loopback origin the first scan came from, or null until one has. */
  origin: () => string | null
  /** Sends the draft list to the loopback page. Nothing goes out before a scan pinned its origin. */
  drafts: (drafts: readonly KitMapDraft[]) => void
  /** The person pressed Save on these drafts. */
  save: (drafts: readonly KitMapDraft[]) => void
  /** A connected computer: the person confirmed the account the terminal named. */
  confirm: () => void
  close: () => void
}

/** Listens on `win` (the framed page's window) and says `ready` to its parent. */
export function openEmbedBridge(win: Window, on: EmbedBridgeEvents): EmbedBridge {
  let pinned: string | null = null
  // The entries `drafts` and `save` are checked against; kept in memory only.
  let entries: readonly KitMapEntry[] = []

  const onMessage = (event: MessageEvent) => {
    if (event.source !== win.parent) return
    if (pinned === null ? !isLoopbackOrigin(event.origin) : event.origin !== pinned) return

    const message = parseKitMapMessage(event.data, entries)
    if (message === null) {
      const version = kitMapMessageVersion(event.data)
      if (version !== null && version !== KIT_MAP_VERSION) on.mismatch(version)
      return
    }

    switch (message.type) {
      case 'scan':
        pinned ??= event.origin
        entries = message.scan.entries
        on.scan(message.scan)
        return
      case 'session':
        if (pinned !== null) on.session(message)
        return
      case 'status':
        if (pinned !== null) on.status(message)
        return
      default:
        // ready, drafts, save, proof-request and proof are the frame's and the
        // save tab's to send, never the loopback page's.
        return
    }
  }

  const send = (message: object) => {
    if (pinned !== null) win.parent.postMessage(message, pinned)
  }

  win.addEventListener('message', onMessage)
  // No origin is known yet, so `ready` names no target. It carries nothing.
  win.parent.postMessage({ type: 'ready', v: KIT_MAP_VERSION }, '*')

  return {
    origin: () => pinned,
    drafts: (drafts) => send({ type: 'drafts', v: KIT_MAP_VERSION, drafts: [...drafts] }),
    save: (drafts) => send({ type: 'save', v: KIT_MAP_VERSION, drafts: [...drafts] }),
    confirm: () => send({ type: 'confirm', v: KIT_MAP_VERSION }),
    close: () => win.removeEventListener('message', onMessage),
  }
}

/** What the frame hands its save tab: the session's one-time proof and the counts, never a skill. */
export interface SaveTabAnswer {
  session: string
  proof: string
  counts: KitMapSaveCounts
}

/**
 * The frame's side of the save tab's handshake (the plan's KTD6). The tab asks
 * its opener for the proof; this answers only the window Save opened (`tab`),
 * only when its message comes from this frame's own origin (skillet.md), and
 * only for the session the terminal named (`answer`). The answer goes to that
 * window alone, addressed to this origin, so a tab that navigated anywhere else
 * never receives it. Returns the function that stops listening.
 */
export function answerSaveTab(
  win: Window,
  from: { tab: () => Window | null; answer: () => SaveTabAnswer | null },
): () => void {
  const onMessage = (event: MessageEvent) => {
    const tab = from.tab()
    if (tab === null || event.source !== tab || event.origin !== win.location.origin) return
    const message = parseKitMapMessage(event.data)
    if (message?.type !== 'proof-request') return
    const answer = from.answer()
    if (answer === null || answer.session !== message.session) return
    const { session, proof, counts } = answer
    tab.postMessage({ type: 'proof', v: KIT_MAP_VERSION, session, proof, counts: { ...counts } }, win.location.origin)
  }
  win.addEventListener('message', onMessage)
  return () => win.removeEventListener('message', onMessage)
}
