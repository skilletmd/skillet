'use client'

import {
  parseAttentionStreamEvent,
  type AttentionStreamEvent,
  type PendingIncreasedEvent,
  type SocialAttentionEvent,
} from '@skillet/protocol/attention-events'

const STREAM_PATH = '/api/me/events/stream'
const MIN_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 60_000

export type AttentionHighSignalEvent = SocialAttentionEvent | PendingIncreasedEvent

type CountsApplier = (social: number, updates: number) => void
type HighSignalHandler = (event: AttentionHighSignalEvent) => void

let applyCounts: CountsApplier | null = null
let source: EventSource | null = null
let subscribers = 0
let backoffMs = MIN_BACKOFF_MS
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let connectSeqFloor = 0
let highestSeq = 0
let tabVisible = true

const highSignalHandlers = new Set<HighSignalHandler>()

/** Wired once from the unread-count store so we avoid a circular import. */
export function registerAttentionCountsApplier(applier: CountsApplier): void {
  applyCounts = applier
}

export function subscribeAttentionHighSignal(handler: HighSignalHandler): () => void {
  highSignalHandlers.add(handler)
  return () => {
    highSignalHandlers.delete(handler)
  }
}

function notifyHighSignal(event: AttentionHighSignalEvent): void {
  if (event.seq <= connectSeqFloor) return
  for (const handler of highSignalHandlers) handler(event)
}

function handleStreamEvent(event: AttentionStreamEvent): void {
  if (event.seq > highestSeq) highestSeq = event.seq
  if (event.type === 'attention') {
    applyCounts?.(event.social, event.updates)
    if (connectSeqFloor === 0) connectSeqFloor = event.seq
    return
  }
  if (event.type === 'social_event' || event.type === 'pending_increased') {
    notifyHighSignal(event)
  }
}

function parseMessage(raw: string): void {
  const event = parseAttentionStreamEvent(raw)
  if (event) handleStreamEvent(event)
}

function scheduleReconnect(): void {
  if (subscribers <= 0 || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined
    connectSeqFloor = highestSeq
    openStream()
  }, backoffMs)
  backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS)
}

function closeStreamConnection(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }
  source?.close()
  source = null
}

function eventSourceAvailable(): boolean {
  return typeof EventSource === 'function'
}

/**
 * Next 16's turbopack dev server tracks every async resource in an internal
 * Map that overflows on a long-lived SSE connection ("RangeError: Map maximum
 * size exceeded"), crashing the dev server after a few minutes. The stream is
 * a nice-to-have — the unread-count store polls independently, so dev stays
 * correct without it. Opt back in with NEXT_PUBLIC_ATTENTION_SSE=1 when you are
 * specifically working on the stream. Production is unaffected (no turbopack).
 */
function attentionStreamEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'development' || process.env.NEXT_PUBLIC_ATTENTION_SSE === '1'
  )
}

function openStream(): void {
  if (typeof window === 'undefined' || subscribers <= 0 || !tabVisible || !eventSourceAvailable()) return
  if (!attentionStreamEnabled()) return
  source?.close()
  source = new EventSource(STREAM_PATH)
  source.onmessage = (msg) => {
    backoffMs = MIN_BACKOFF_MS
    parseMessage(msg.data)
  }
  source.onerror = () => {
    closeStreamConnection()
    scheduleReconnect()
  }
}

/** Pause the live stream while the tab is hidden; poll remains the fallback. */
export function setAttentionStreamTabVisible(visible: boolean): void {
  tabVisible = visible
  if (visible) {
    if (subscribers > 0) openStream()
    return
  }
  closeStreamConnection()
}

export function ensureAttentionStream(): void {
  if (typeof window === 'undefined') return
  subscribers += 1
  if (subscribers === 1) {
    connectSeqFloor = highestSeq
    backoffMs = MIN_BACKOFF_MS
    openStream()
  }
}

export function releaseAttentionStream(): void {
  subscribers = Math.max(0, subscribers - 1)
  if (subscribers > 0) return
  closeStreamConnection()
}

/** Test hook: feed a parsed SSE payload without a live EventSource. */
export function ingestAttentionStreamPayloadForTest(raw: string): void {
  parseMessage(raw)
}

/** Test hook: reset module state between cases. */
export function resetAttentionStreamForTest(): void {
  releaseAttentionStream()
  subscribers = 0
  connectSeqFloor = 0
  highestSeq = 0
  tabVisible = true
  backoffMs = MIN_BACKOFF_MS
  highSignalHandlers.clear()
}
