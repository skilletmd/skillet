/**
 * Summon suggestions: the three paste-ready `/skillet @handle <task>` lines a
 * profile shows.
 *
 * Shared here because three parties have to agree on the stored shape: the
 * registry writes it, the profile payload reads it, and the backfill script
 * generates it. A JSON blob on `authors` with three independent readers is
 * exactly the kind of field that drifts when its shape lives at each call site.
 *
 * Each entry carries the ref it was derived from, not just the phrase. That ref
 * is what makes "every suggestion resolves" checkable — at generation time it
 * proves the line came from a real skill, and at read time it lets the profile
 * drop a line whose skill went private before showing a summon that would miss.
 */

/** One suggested invocation: the task text, and the skill it was derived from. */
export interface SummonSuggestion {
  /** Imperative task phrase, rendered after `/skillet @handle`. Plain text. */
  task: string
  /** `@author/slug` of the skill this phrase was derived from. */
  ref: string
}

/** At most this many suggestions per author. Three is the rendered set. */
export const MAX_SUMMON_SUGGESTIONS = 3

/**
 * The stored envelope.
 *
 * `kit_signature` rides inside the JSON rather than taking its own column: it
 * is only ever read alongside the set it describes, to decide whether that set
 * is stale. A separate column would be a second thing to keep in sync for no
 * independent query.
 */
export interface SummonSuggestionSet {
  suggestions: SummonSuggestion[]
  /** The kit shape these were generated from. See `kitSignature`. */
  kit_signature: string
}

/** Voice for the block heading. Derived from claim state, not from the set. */
export type SummonSuggestionVoice = 'first-person' | 'third-person'

/**
 * A compact description of a kit's shape: how many public skills, and how they
 * spread across categories. Regeneration compares this against the stored one,
 * so a publish that does not move the shape does not spend a model call.
 *
 * Sorted by category key so the same kit always produces the same string
 * regardless of row order.
 */
export function kitSignature(categories: Array<string | null>): string {
  const counts = new Map<string, number>()
  for (const c of categories) {
    const key = c ?? 'uncategorized'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const parts = [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, n]) => `${key}:${n}`)
  return `${categories.length}|${parts.join(',')}`
}

/** Whether two signatures differ enough to be worth regenerating. */
export function signatureDrifted(
  stored: string | null | undefined,
  current: string,
  opts: { minSkillDelta?: number } = {},
): boolean {
  if (!stored) return true
  if (stored === current) return false

  const minDelta = opts.minSkillDelta ?? 3
  const storedCount = Number.parseInt(stored.split('|')[0] ?? '', 10)
  const currentCount = Number.parseInt(current.split('|')[0] ?? '', 10)
  if (!Number.isFinite(storedCount) || !Number.isFinite(currentCount)) return true

  // A new category is a shape change however few skills came with it: it is
  // exactly the case where a suggestion is missing a whole area of the kit.
  const cats = (sig: string): Set<string> =>
    new Set(
      (sig.split('|')[1] ?? '')
        .split(',')
        .filter(Boolean)
        .map((p) => p.split(':')[0] ?? ''),
    )
  const storedCats = cats(stored)
  for (const c of cats(current)) {
    if (!storedCats.has(c)) return true
  }

  return Math.abs(currentCount - storedCount) >= minDelta
}

/**
 * Parse the stored JSON. Returns null for absent, which is distinct from an
 * empty set: absent means never generated (the backfill should pick it up),
 * empty means generated and the kit could not support a confident line (it
 * should not be retried).
 */
export function parseSummonSuggestionSet(raw: string | null | undefined): SummonSuggestionSet | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  const obj = parsed as Record<string, unknown>
  const list = obj['suggestions']
  if (!Array.isArray(list)) return null

  const suggestions: SummonSuggestion[] = []
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    const task = typeof e['task'] === 'string' ? e['task'].trim() : ''
    const ref = typeof e['ref'] === 'string' ? e['ref'].trim() : ''
    if (!task || !ref) continue
    suggestions.push({ task, ref })
  }

  // Over-length is corruption, not something to quietly truncate into a
  // plausible-looking set.
  if (suggestions.length > MAX_SUMMON_SUGGESTIONS) return null

  return {
    suggestions,
    kit_signature: typeof obj['kit_signature'] === 'string' ? obj['kit_signature'] : '',
  }
}

/** Serialize for storage. Rejects an over-length set rather than truncating. */
export function serializeSummonSuggestionSet(set: SummonSuggestionSet): string {
  if (set.suggestions.length > MAX_SUMMON_SUGGESTIONS) {
    throw new Error(
      `Refusing to store ${set.suggestions.length} summon suggestions; the cap is ${MAX_SUMMON_SUGGESTIONS}`,
    )
  }
  return JSON.stringify({
    suggestions: set.suggestions.map((s) => ({ task: s.task, ref: s.ref })),
    kit_signature: set.kit_signature,
  })
}

/** The full line a visitor copies. The handle is part of the artifact. */
export function summonSuggestionLine(handle: string, task: string): string {
  const bare = handle.trim().replace(/^@/, '')
  return `/skillet @${bare} ${task.trim()}`
}
