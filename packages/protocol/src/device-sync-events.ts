/** SSE envelopes for device sync streams (registry -> desktop). */

export type DeviceSyncRequiredEvent = {
  type: 'sync_required'
  seq: number
}

export type DeviceSyncStreamEvent = DeviceSyncRequiredEvent

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function readSeq(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Parse one SSE `data:` JSON payload; returns null when unknown or malformed. */
export function parseDeviceSyncStreamEvent(raw: string): DeviceSyncStreamEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.type !== 'sync_required') return null
  const seq = readSeq(parsed.seq)
  if (seq == null) return null
  return { type: 'sync_required', seq }
}
