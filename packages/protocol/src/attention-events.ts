/** SSE envelopes for web attention streams (registry → BFF → browser). */

export type AttentionCountsEvent = {
  type: 'attention'
  social: number
  updates: number
  seq: number
}

export type SocialAttentionEvent = {
  type: 'social_event'
  kind: 'followed_you' | 'subscribed_kit' | 'subscribed_author' | 'installed_skill'
  actor: string
  at: number
  seq: number
}

export type PendingIncreasedEvent = {
  type: 'pending_increased'
  seq: number
}

export type AttentionStreamEvent = AttentionCountsEvent | SocialAttentionEvent | PendingIncreasedEvent

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function readSeq(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Parse one SSE `data:` JSON payload; returns null when unknown or malformed. */
export function parseAttentionStreamEvent(raw: string): AttentionStreamEvent | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return null
  const seq = readSeq(parsed.seq)
  if (seq == null) return null

  if (parsed.type === 'attention') {
    const social = parsed.social
    const updates = parsed.updates
    if (typeof social !== 'number' || typeof updates !== 'number') return null
    return { type: 'attention', social, updates, seq }
  }

  if (parsed.type === 'social_event') {
    const kind = parsed.kind
    const actor = parsed.actor
    const at = parsed.at
    if (
      kind !== 'followed_you' &&
      kind !== 'subscribed_kit' &&
      kind !== 'subscribed_author' &&
      kind !== 'installed_skill'
    ) {
      return null
    }
    if (typeof actor !== 'string' || typeof at !== 'number') return null
    return { type: 'social_event', kind, actor, at, seq }
  }

  if (parsed.type === 'pending_increased') {
    return { type: 'pending_increased', seq }
  }

  return null
}
