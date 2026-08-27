/**
 * Reading a stored suggestion set out to a profile, and validating one an
 * author edited themselves.
 *
 * Pure, so the rules that matter can be tested without a database. The one that
 * matters most: a stored set outlives the skills it was generated from. A skill
 * goes private, gets unlisted, or is deleted, and the line pointing at it
 * becomes a summon that misses — on the one surface whose whole promise is that
 * it will not.
 */
import {
  MAX_SUMMON_SUGGESTIONS,
  type SummonSuggestion,
  type SummonSuggestionVoice,
} from '@skillet/protocol'

/**
 * Drop suggestions whose skill is no longer publicly resolvable.
 *
 * `publicRefs` is the same visibility-filtered set the profile already renders,
 * so a suggestion survives exactly when the reader could reach the skill behind
 * it. Filtering rather than blanking: two good lines are worth showing, and
 * losing one is not a reason to withhold the others.
 */
export function filterResolvableSuggestions(
  suggestions: SummonSuggestion[],
  publicRefs: ReadonlySet<string>,
): SummonSuggestion[] {
  return suggestions.filter((s) => publicRefs.has(s.ref))
}

/**
 * Which voice the block speaks in.
 *
 * An unclaimed mirror is other people's work republished with its source
 * stated; a suggestion there describes a repo, it does not speak as its author.
 * Once claimed, the person is the one talking.
 */
export function suggestionVoice(isUnclaimedMirror: boolean): SummonSuggestionVoice {
  return isUnclaimedMirror ? 'third-person' : 'first-person'
}

/** Why an author's own edit was rejected. */
export type EditedSuggestionsError =
  | 'too_many_suggestions'
  | 'invalid_task'
  | 'unknown_ref'
  | 'malformed_suggestions'

/** Control characters, which a task phrase never legitimately contains. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/

/**
 * Validate a suggestion set an author edited themselves.
 *
 * Deliberately NOT `isPublishablePhrase`. That validator judges model output,
 * where anything unexpected is a reason to discard; a person editing their own
 * profile is allowed punctuation, capitals, and their own phrasing. What still
 * holds is what protects the reader: a bounded length, one line, and a ref that
 * actually belongs to this author and is publicly reachable — otherwise an
 * author could publish a line pointing at a private skill, or at someone else's
 * work, and it would resolve to nothing or to the wrong person.
 */
export function validateEditedSuggestions(
  input: unknown,
  ownedPublicRefs: ReadonlySet<string>,
): { ok: true; suggestions: SummonSuggestion[] } | { ok: false; error: EditedSuggestionsError } {
  if (!Array.isArray(input)) return { ok: false, error: 'malformed_suggestions' }
  if (input.length > MAX_SUMMON_SUGGESTIONS) return { ok: false, error: 'too_many_suggestions' }

  const out: SummonSuggestion[] = []
  for (const entry of input) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: 'malformed_suggestions' }
    }
    const e = entry as Record<string, unknown>
    const task = typeof e['task'] === 'string' ? e['task'].trim() : ''
    const ref = typeof e['ref'] === 'string' ? e['ref'].trim() : ''

    if (!task || task.length > 60 || CONTROL_CHARS.test(task)) {
      return { ok: false, error: 'invalid_task' }
    }
    if (!ownedPublicRefs.has(ref)) return { ok: false, error: 'unknown_ref' }
    out.push({ task, ref })
  }
  return { ok: true, suggestions: out }
}
