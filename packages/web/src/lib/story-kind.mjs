/**
 * The two kinds of thing Skillet Daily covers, and the eyebrow each one shows.
 *
 * A skill story and a news story answer different reader questions. A skill
 * story answers "would I install this", so its headline leads with the skill
 * and what it does. A news story answers "what happened", so its headline leads
 * with the actor. The distinction is carried here rather than inferred at each
 * render, because the writer and the ranker both branch on it.
 *
 * Two labels, deliberately. An earlier pass had five (Launch, From the labs,
 * Research, The argument, Trust); they read as taxonomy rather than orientation
 * and told a scanning reader nothing the headline did not already say.
 *
 * Singular, because the label sits on one card and describes that card.
 *
 * Kept as .mjs so the drafting script and the React tree read the same list; a
 * second copy in the script would drift, and a drifted kind renders as a bare
 * fallback with nothing erroring.
 */
export const SKILL_KIND = 'skill'
export const NEWS_KIND = 'news'

export const STORY_KICKER = {
  [SKILL_KIND]: 'Skill',
  [NEWS_KIND]: 'News',
}

/** Every kind the writer may return. */
export const STORY_KINDS = Object.keys(STORY_KICKER)

export const storyKicker = (kind) => STORY_KICKER[kind ?? ''] ?? 'News'
