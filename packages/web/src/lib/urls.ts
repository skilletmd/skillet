// Single source of truth for owner-namespaced permalinks. Every skill / kit /
// profile href in the app is built here so the
// URL scheme is enforceable in one place rather than scattered across ~40 inline
// template literals. The scheme is GitHub/npm-style, owner-first:
//
//   /{owner}                  profile
//   /{owner}/{skill}          a skill            (skills are the flat primary object)
//   /{owner}/kit              author everything-kit
//   /{owner}/kit/{slug}       a named kit
//
// Handles and slugs are already URL-safe (lowercase alphanumerics + hyphen), so
// path segments are interpolated verbatim; only opaque query values (proposal
// ids) are percent-encoded.

import { ADD_INTENT_PARAM, encodeAddIntent, type AddIntent } from './add-intent'

/** Canonical public GitHub repository. Env-overridable so the OSS org (or a
 *  fork) can point "Edit on GitHub" and the footer link at its own repo without
 *  a code change. Set NEXT_PUBLIC_GITHUB_REPO_URL to override the default. */
export const GITHUB_REPO_URL =
  process.env.NEXT_PUBLIC_GITHUB_REPO_URL ?? 'https://github.com/skilletmd/skillet'

/** `owner/repo` parsed from GITHUB_REPO_URL — the repository whose GitHub
 *  Releases back the desktop download + auto-update endpoints (/download*,
 *  /desktop/latest.json). Derived from the same single source as every other
 *  repo link, so a rename is one env change and shipped apps never care. */
export const GITHUB_RELEASES_REPO = new URL(GITHUB_REPO_URL).pathname
  .replace(/^\/+|\/+$/g, '')
  .replace(/\.git$/, '')

/** The author's public profile. */
export function profileHref(owner: string): string {
  return `/${owner}`
}

/** A skill's canonical detail page. */
export function skillHref(author: string, slug: string): string {
  return `/${author}/${slug}`
}

/**
 * The blog index, or a post's canonical permalink. Unlike the handle/slug
 * helpers above, this one also builds the `<link rel="canonical">` and `og:url`
 * for a post from a raw route param, so the segment is percent-encoded: a
 * canonical is a strong instruction to a crawler and must never be able to
 * point outside `/blog/`. Encoding is a no-op for stored slugs, which are
 * already lowercase alphanumerics plus hyphen.
 */
export function blogHref(slug?: string): string {
  return slug ? `/blog/${encodeURIComponent(slug)}` : '/blog'
}

/** The skill editor (owner-only). */
export function skillEditHref(author: string, slug: string): string {
  return `/${author}/${slug}/edit`
}

/**
 * Deep-link into a skill's Files viewer, focused on a file (and optionally a
 * line). The skill page reads `?view=<path>` (+ `&line=<n>`) on mount and opens
 * that file in the source view, scrolling to the line. Kit pages use this so a
 * flagged member-skill line links to its full context in the canonical viewer
 * instead of duplicating a viewer onto the kit. The path is an opaque query
 * value, so it is percent-encoded.
 */
export function skillViewHref(
  author: string,
  slug: string,
  file: string,
  line?: number,
): string {
  const base = `${skillHref(author, slug)}?view=${encodeURIComponent(file)}`
  return line != null ? `${base}&line=${line}` : base
}

/** The "propose a change" form for a skill. */
export function skillProposeHref(author: string, slug: string): string {
  return `/${author}/${slug}/propose`
}

/**
 * The review-and-decide surface for a skill, optionally focused on one proposal.
 * The canonical builder lives here; `lib/proposals.ts` re-exports it.
 */
export function skillReviewHref(author: string, slug: string, proposalId?: string): string {
  const base = `/${author}/${slug}/review`
  return proposalId ? `${base}?proposal=${encodeURIComponent(proposalId)}` : base
}

/** The author everything-kit (every public skill by an owner, auto-updating). */
export function authorKitHref(owner: string): string {
  return `/${owner}/kit`
}

/** A named/curated kit, addressed by its per-owner slug. */
export function kitHref(owner: string, slug: string): string {
  return `/${owner}/kit/${slug}`
}

/** The owner-only edit surface for a named kit — mirrors the public permalink. */
export function kitEditHref(owner: string, slug: string): string {
  return `/${owner}/kit/${slug}/edit`
}

// --- Feed / Browse section hrefs ---------------------------------------------
// Not owner-namespaced, but routed through here so the feed-tab and browse-view
// URL scheme has one source of truth rather than scattered inline literals.

/** The Feed destination — the bare /feed is the For-you lens. */
export function feedHref(): string {
  return '/feed'
}

/** The Feed Global lens (everyone's activity). */
export function feedGlobalHref(): string {
  return '/feed/global'
}

/** Notifications — social events directed at the viewer (top-level destination). */
export function feedNotificationsHref(): string {
  return '/notifications'
}

/** Updates — the skill/kit update queue (top-level destination). */
export function feedUpdatesHref(): string {
  return '/updates'
}

/** Browse — the destination root, which is the curated Featured view. */
export function browseHref(): string {
  return '/browse'
}

/** Browse — the curated Featured view (the /browse default). */
export function browseFeaturedHref(): string {
  return '/browse'
}

/** Browse — the full All Skills grid. */
export function browseAllHref(): string {
  return '/browse/all'
}

/**
 * The sign-in page, optionally carrying a post-login destination. The login
 * page reads `callbackUrl` (via `safeCallbackPath`), so every "sign in to do X"
 * link must use this key — and always percent-encode the path — rather than
 * hand-building the query string. One builder keeps the param name and encoding
 * consistent (a stray `?next=` silently drops the redirect).
 */
export function loginHref(callbackPath?: string): string {
  if (!callbackPath) return '/login'
  return `/login?callbackUrl=${encodeURIComponent(callbackPath)}`
}

/**
 * A sign-in link for a logged-out "Add" that preserves the add intent across the
 * login round trip. The intent rides as an `?add=` token on the post-login
 * destination (default: home), so after auth the add-intent handler can replay
 * it. `loginHref` percent-encodes the whole callback path, so the inner query is
 * carried verbatim. See `lib/add-intent.ts`.
 */
export function addIntentLoginHref(intent: AddIntent, returnTo = '/'): string {
  const sep = returnTo.includes('?') ? '&' : '?'
  return loginHref(`${returnTo}${sep}${ADD_INTENT_PARAM}=${encodeAddIntent(intent)}`)
}

/**
 * Where an Add sends a viewer who's signed in but hasn't claimed a username yet.
 * Adding needs a public identity, so we route to the claim UI on /settings and
 * carry the same `?add=` token — once the handle lands, the membership provider
 * mounts and the add-intent handler replays the add (see `add-intent-handler`).
 */
export function addIntentClaimHref(intent: AddIntent): string {
  return `/settings?${ADD_INTENT_PARAM}=${encodeAddIntent(intent)}`
}

/**
 * Build a named-kit href from a kit record. Prefers the slug permalink; falls
 * back to the legacy `/kits/{uuid}` path (which the legacy route resolves and
 * 308-redirects to the slug form) when the slug isn't available — e.g. fresh
 * post-creation records that only carry the UUID.
 */
export function kitHrefFromRecord(kit: {
  owner?: string | null
  slug?: string | null
  id: string
}): string {
  if (kit.owner && kit.slug) return kitHref(kit.owner, kit.slug)
  return `/kits/${kit.id}`
}
