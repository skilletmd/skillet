// Canonical slug generation — single source of truth shared by the registry
// (authoritative), the web client, and the CLI importers. Historically this
// logic was copy-pasted across ~10 sites, each running
// `.replace(/[^a-z0-9]+/g, '-')`. That collapses EVERY non-alphanumeric run to a
// dash, so `writer's room` became `writer-s-room` — the apostrophe split a word
// it should have closed. We strip apostrophes (straight and typographic) BEFORE
// collapsing, so `writer's room` → `writers-room`.
//
// Kept behavior a strict superset of the old kit slugifier: the `fallback` and
// `maxLength` options reproduce its `|| 'kit'` and 64-char cap so existing call
// sites adopt this without surprise (apart from the intended apostrophe fix).

export interface SlugifyOptions {
  /** Returned when the input slugifies to an empty string. Default: `''`. */
  fallback?: string
  /** Maximum length; the result is truncated and re-trimmed of edge dashes. */
  maxLength?: number
}

/** Apostrophes elided rather than dashed: straight `'`, typographic `'`, backtick-ish. */
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
