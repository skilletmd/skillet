// Logged-out "Add" conversion funnel. A visitor who clicks Add while signed out
// is sent to /login, but the THING they wanted to add must survive the round
// trip — otherwise they land somewhere having added nothing. We encode the
// intent into the post-login destination as a single `?add=` token; after auth a
// client handler (see components/add-intent-handler.tsx) replays the add against
// the SAME registry routes the logged-in controls use, then strips the token.
//
// Token shape (one opaque value, percent-encoded once by `loginHref`):
//   add=skill:<author>/<slug>   → add the skill to the viewer's library (Saved kit)
//   add=kit:<kitId>             → subscribe the viewer to the kit

import { registryAuthApi } from './registry-proxy'

/** The query key carrying an add intent through login. */
export const ADD_INTENT_PARAM = 'add'

export type AddIntent =
  | { type: 'skill'; author: string; slug: string }
  | { type: 'kit'; kitId: string }

/** Serialize an intent into its `?add=` token (author/slug are already URL-safe). */
export function encodeAddIntent(intent: AddIntent): string {
  return intent.type === 'skill'
    ? `skill:${intent.author}/${intent.slug}`
    : `kit:${intent.kitId}`
}

/** Parse an `?add=` token back into an intent, or null if absent/malformed. */
export function parseAddIntent(raw: string | null | undefined): AddIntent | null {
  if (!raw) return null
  const colon = raw.indexOf(':')
  if (colon === -1) return null
  const type = raw.slice(0, colon)
  const rest = raw.slice(colon + 1)

  if (type === 'skill') {
    const slash = rest.indexOf('/')
    if (slash === -1) return null
    const author = rest.slice(0, slash)
    const slug = rest.slice(slash + 1)
    if (!author || !slug) return null
    return { type: 'skill', author, slug }
  }
  if (type === 'kit') {
    if (!rest) return null
    return { type: 'kit', kitId: rest }
  }
  return null
}

// --- Add actions ------------------------------------------------------------
// The single source of truth for the two POSTs the funnel replays. The logged-in
// controls (skill-kit-control, subscribe-kit-button) call these too, so the
// funnel can never drift from the real add path.

/** POST a skill into a kit (the Saved/library kit, or any named kit). */
export function addSkillToKit(kitId: string, author: string, slug: string): Promise<Response> {
  return fetch(registryAuthApi(`kits/${kitId}/skills`), {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ author, slug }),
  })
}

/** POST a kit subscription (follow the kit so it stays in sync). */
export function subscribeToKit(kitId: string): Promise<Response> {
  return fetch(registryAuthApi(`kits/${encodeURIComponent(kitId)}/subscribe`), {
    method: 'POST',
    headers: { accept: 'application/json' },
  })
}
