// Client-safe slug generation for the web package. Mirrors the canonical
// `slugify` in @skillet/protocol, intentionally NOT importing it: the protocol
// barrel re-exports modules that pull in `node:crypto` (delegation/bundle), so
// importing it from a 'use client' component (CreateTeamForm, KitDetailClient)
// would drag a Node builtin into the browser bundle. This file is a pure-string
// duplicate — keep it byte-for-byte behaviorally identical to protocol/slugify.
//
// Key behavior: apostrophes are elided rather than dashed, so "writer's room"
// becomes "writers-room" (not "writer-s-room").

export interface SlugifyOptions {
  /** Returned when the input slugifies to an empty string. Default: `''`. */
  fallback?: string
  /** Maximum length; the result is truncated and re-trimmed of edge dashes. */
  maxLength?: number
}

const APOSTROPHES = /['’‘`´]/g

export function slugify(input: string, options: SlugifyOptions = {}): string {
  let slug = input
    .toLowerCase()
    .replace(APOSTROPHES, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  if (options.maxLength != null && slug.length > options.maxLength) {
    slug = slug.slice(0, options.maxLength).replace(/-+$/g, '')
  }

  return slug || options.fallback || ''
}
