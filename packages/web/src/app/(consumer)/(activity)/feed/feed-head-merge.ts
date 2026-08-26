import type { FeedEvent } from '@/lib/registry'

/** Stable identity for dedup across head polls and infinite scroll. */
export function feedEventKey(e: FeedEvent): string {
  if (e.kind === 'skill') return `s:${e.skill.author}/${e.skill.slug}:${e.at}`
  if (e.kind === 'subscribe') return `b:${e.actor}:${e.target.href}:${e.at}`
  // A post's URL is its identity: the same link surfacing from two search nets
  // is one item, and `at` is the post's own time so it never drifts.
  if (e.kind === 'signal') return `g:${e.url}`
  if (e.kind === 'story') return `t:${e.id}`
  return `f:${e.actor}:${e.at}`
}

/** Merge a head page into the loaded list; unseen events prepend in head order. */
export function mergeFeedHead(
  events: FeedEvent[],
  head: FeedEvent[],
  seen: Set<string>,
): { prepended: FeedEvent[]; merged: FeedEvent[] } {
  const prepended: FeedEvent[] = []
  for (const e of head) {
    const k = feedEventKey(e)
    if (seen.has(k)) continue
    seen.add(k)
    prepended.push(e)
  }
  if (prepended.length === 0) return { prepended, merged: events }
  return { prepended, merged: [...prepended, ...events] }
}
