import {
  parseDeviceSyncStreamEvent,
  type DeviceSyncStreamEvent,
} from '@skillet/protocol/device-sync-events'

export type DeviceSyncStreamConfig = {
  registryUrl: string
  deviceToken: string
}

export type DeviceSyncStreamController = {
  stop: () => void
}

export const DEVICE_SYNC_CURSOR_KEY = 'deviceSyncLastSeq'

export function readPersistedDeviceSyncSeq(): number | null {
  try {
    const raw = localStorage.getItem(DEVICE_SYNC_CURSOR_KEY)
    if (raw == null) return null
    const seq = Number(raw)
    return Number.isFinite(seq) ? seq : null
  } catch {
    return null
  }
}

export function persistDeviceSyncSeq(seq: number): void {
  try {
    localStorage.setItem(DEVICE_SYNC_CURSOR_KEY, String(seq))
  } catch {
    /* private mode */
  }
}

export function clearPersistedDeviceSyncSeq(): void {
  try {
    localStorage.removeItem(DEVICE_SYNC_CURSOR_KEY)
  } catch {
    /* private mode */
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

type StartDeviceSyncStreamOptions = {
  config: DeviceSyncStreamConfig
  fetchImpl?: FetchLike
  onSyncRequired: (seq: number) => void | Promise<void>
  onError?: (error: unknown) => void
  minRetryMs?: number
  maxRetryMs?: number
}

export function deviceSyncStreamUrl(config: DeviceSyncStreamConfig): string {
  return `${config.registryUrl.replace(/\/+$/, '')}/api/v1/devices/sync/stream`
}

export function shouldTriggerDeviceSync(
  lastSeenSeq: number | null,
  event: DeviceSyncStreamEvent,
): boolean {
  return lastSeenSeq != null && event.seq > lastSeenSeq
}

export function readSseDataMessages(input: string): { messages: string[]; rest: string } {
  const normalized = input.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const rest = parts.pop() ?? ''
  const messages = parts
    .map((part) =>
      part
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart())
        .join('\n'),
    )
    .filter((msg) => msg.length > 0)
  return { messages, rest }
}

function retryDelay(current: number, max: number): number {
  return Math.min(current * 2, max)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export function startDeviceSyncStream(options: StartDeviceSyncStreamOptions): DeviceSyncStreamController {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const minRetryMs = options.minRetryMs ?? 1_000
  const maxRetryMs = options.maxRetryMs ?? 30_000
  let stopped = false
  let abortController: AbortController | null = null
  let lastSeenSeq: number | null = readPersistedDeviceSyncSeq()

  const run = async () => {
    let nextRetryMs = minRetryMs
    while (!stopped) {
      abortController = new AbortController()
      try {
        const res = await fetchImpl(deviceSyncStreamUrl(options.config), {
          headers: {
            accept: 'text/event-stream',
            authorization: `Bearer ${options.config.deviceToken}`,
          },
          signal: abortController.signal,
        })
        if (!res.ok || !res.body) throw new Error(`device sync stream failed: ${res.status}`)

        nextRetryMs = minRetryMs
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const chunk = await reader.read()
          if (chunk.done || stopped) break
          buffer += decoder.decode(chunk.value, { stream: true })
          const parsed = readSseDataMessages(buffer)
          buffer = parsed.rest
          for (const message of parsed.messages) {
            const event = parseDeviceSyncStreamEvent(message)
            if (!event) continue
            const shouldSync = shouldTriggerDeviceSync(lastSeenSeq, event)
            if (lastSeenSeq == null || event.seq > lastSeenSeq) {
              lastSeenSeq = event.seq
              persistDeviceSyncSeq(event.seq)
            }
            if (!shouldSync) continue
            await options.onSyncRequired(event.seq)
          }
        }
      } catch (error) {
        if (!stopped) options.onError?.(error)
      }
      if (!stopped) {
        await sleep(nextRetryMs)
        nextRetryMs = retryDelay(nextRetryMs, maxRetryMs)
      }
    }
  }

  void run()

  return {
    stop: () => {
      stopped = true
      abortController?.abort()
    },
  }
}
