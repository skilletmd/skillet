/**
 * Reading a stored suggestion set out to a profile.
 *
 * Pure, so the rule that matters can be tested without a database: a stored set
 * outlives the skills it was generated from. A skill goes private, gets
 * unlisted, or is deleted, and the line pointing at it becomes a summon that
 * misses — on the one surface whose whole promise is that it will not.
 */
import type { SummonSuggestion, SummonSuggestionVoice } from '@skillet/protocol'

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
