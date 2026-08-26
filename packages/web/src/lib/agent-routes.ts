/**
 * Which URLs this site actually serves — decided before rendering, so an
 * unknown path can leave with a real `404` instead of a `200` carrying the
 * 404 page.
 *
 * Why it can't be decided during rendering: under `cacheComponents` every
 * document route flushes a prerendered PPR shell before the page body runs
 * (`x-nextjs-postponed: 1` on the wire). By the time a page calls `notFound()`
 * the status line is already sent, so Next serves the branded 404 body with a
 * `200`. Agents probing for `/openapi.json`, `/.well-known/…`, or any guessed
 * handle concluded every path existed. The decision has to happen in
 * `proxy.ts`, which runs before the first byte.
 *
 * Three tiers, cheapest first:
 *   1. structural — the path matches no route shape at all. No I/O.
 *   2. enumerable — a dynamic segment whose full value set is known in-process
 *      (browse categories, docs pages). No I/O.
 *   3. registry-backed — handle- and skill-shaped paths, which need a lookup.
 *      Handled by the caller; this module only classifies.
 *
 * Everything here is pure and free of `node:*` so `proxy.ts` can import it.
 */

import { RESERVED_SKILL_SLUGS, SKILL_SLUG_RE } from '@skillet/protocol/reserved-skill-slugs'
import { PROTECTED_RESOURCE_WELL_KNOWN } from '@skillet/protocol/protected-resource'
import { CATEGORY_BY_KEY, isCategoryKey } from './categories'
import { DOC_NAV } from './docs-nav'

/**
 * The registry's claim-gate handle grammar. Kept as a literal rather than
 * imported from `@skillet/protocol/skill-id` because that module exports
 * parsers, not the bare pattern, and `proxy.ts` wants the cheapest possible
 * test. The parity is asserted in `tests/agent-routes.test.ts`.
 */
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,38}$/

/**
 * First path segments this app serves with a static route (or a config
 * redirect that fires before `proxy.ts` ever sees the request).
 *
 * Hand-maintained on purpose: `proxy.ts` has no filesystem, so the table cannot
 * be derived at request time. `tests/agent-routes.test.ts` walks `src/app` AND
 * `public/` and fails when a real segment is missing here — add a route or a
 * public folder, add it here, or it starts 404ing for logged-out visitors.
 *
 * `public/` counts because proxy.ts answers before Next's static handler runs,
 * so an unlisted asset folder is a 404 even though the file is right there on
 * disk. That is not hypothetical: `brand/` and `avatars/` were missing, which
 * took out the wordmark (a CSS mask on /brand/skillet-mascot-logo.svg) and
 * every generated cover (they paint /brand/grain.png as their grain texture).
 * `favicon.ico` was listed and loaded fine, which is what made the 404s look
 * like a CSP or bundler problem rather than this table.
 */
export const KNOWN_TOP_LEVEL_SEGMENTS: ReadonlySet<string> = new Set([
  // The branded 404 body at a fixed URL; proxy.ts renders it through this page.
  '404',
  // Marketing, catalog, and account surfaces.
  'about',
  'admin',
  'api',
  'blog',
  'browse',
  'connect',
  'contact',
  'create',
  'desktop',
  'docs',
  'download',
  'feed',
  'github.com',
  'home',
  'import',
  'install',
  'internal',
  'kits',
  'lab',
  'legal',
  'login',
  'moderation',
  'news',
  'notifications',
  'privacy',
  'search',
  'settings',
  'skills',
  'stats',
  'updates',
  'setup',
  // Machine-readable surfaces. `.well-known` covers every RFC 8615 suffix we
  // publish; the individual files under it are real routes.
  '.well-known',
  'llms.txt',
  'openapi.json',
  'robots.txt',
  'sitemap.xml',
  // Next metadata routes generated from `app/*.tsx` convention files.
  'favicon.ico',
  'icon',
  'apple-icon',
  'opengraph-image',
  // Sources of `next.config` redirects. Those fire before proxy runs, but a
  // stale bookmark should never depend on ordering to avoid a 404.
  'new',
  'safety',
  'status',
  // Top-level folders of `public/`. Static files Next would serve happily if
  // proxy.ts let the request reach it. `docs` is deliberately absent here — it
  // is already listed above as a page route and serves both.
  'avatars',
  'brand',
  'illustrations',
  'setup',
])

/** Browse category keys, plus the `all` pseudo-category the route also serves. */
function browseSegments(): ReadonlySet<string> {
  return new Set([...Object.keys(CATEGORY_BY_KEY), 'all'])
}

/**
 * Docs paths that resolve, derived from the sidebar. `DOC_NAV` is the site's
 * navigation source of truth and `tests/docs-nav-coverage.test.ts` holds it to
 * every file in `content/docs`, so it doubles as the docs route table.
 */
/**
 * Docs routes rendered by a React page rather than a Markdown file.
 *
 * They resolve as HTML, so `classifyRoute` must call them `known`. They have no
 * source document, so `renderMarkdown` cannot produce a twin for them and
 * `hasMarkdownVariant` must say so — claiming one sent an agent that asked for
 * `text/markdown` to a 404 while a browser got the page, and pointed the
 * `rel="alternate"` link at a dead URL.
 */
const DOCS_WITHOUT_MARKDOWN: ReadonlySet<string> = new Set(['/docs/scanner', '/docs/runtimes'])

function docsPaths(): ReadonlySet<string> {
  const out = new Set<string>(['/docs'])
  for (const section of DOC_NAV) for (const item of section.items) out.add(item.href)
  for (const path of DOCS_WITHOUT_MARKDOWN) out.add(path)
  return out
}

/**
 * The `.well-known` suffixes this origin serves. Kept beside the routes that
 * implement them: `app/.well-known/mcp.json`,
 * `app/.well-known/agent-skills/index.json`, the per-skill artifact route, and
 * the two RFC 9728 protected-resource documents.
 *
 * The protected-resource paths are lowercased already (`PROTECTED_RESOURCE_WELL_KNOWN`
 * emits them that way), so comparing against the lowercased segments is exact
 * rather than lenient. Deriving them from the protocol table instead of
 * spelling them here means a change to the API version prefix moves the route
 * and this check together.
 */
const PROTECTED_RESOURCE_PATHS: ReadonlySet<string> = new Set(
  Object.values(PROTECTED_RESOURCE_WELL_KNOWN),
)

function pathnameIsWellKnown(segments: string[]): boolean {
  const [, second, third, fourth] = segments
  if (segments.length === 2 && second === 'mcp.json') return true
  if (PROTECTED_RESOURCE_PATHS.has(`/${segments.join('/')}`)) return true
  if (second !== 'agent-skills') return false
  if (segments.length === 3 && third === 'index.json') return true
  return segments.length === 4 && fourth === 'skill.md'
}

/** How a path should be treated before rendering. */
export type RouteVerdict =
  /** A route serves this path. Render it. */
  | { kind: 'known' }
  /** No route can serve this path. Answer 404 without touching the registry. */
  | { kind: 'unknown' }
  /** Shape-valid but existence is a registry question. `check` names the lookup. */
  | { kind: 'registry'; check: RegistryLookup }

/** The registry lookups `proxy.ts` knows how to perform. */
export type RegistryLookup =
  | { type: 'author'; author: string }
  | { type: 'skill'; author: string; slug: string }
  | { type: 'kit'; owner: string; slug: string }

const SKILL_SUBPAGES = new Set(['edit', 'propose', 'review'])

/**
 * Classify a pathname. Callers pass an already-normalized pathname (leading
 * slash, no query, no trailing slash except for the root).
 *
 * Fails toward `known`: an ambiguous shape renders as it does today rather
 * than risking a 404 on a page that exists.
 */
export function classifyRoute(pathname: string): RouteVerdict {
  if (pathname === '/' || pathname === '') return { kind: 'known' }
  if (!pathname.startsWith('/')) return { kind: 'known' }

  const raw = pathname.slice(1).split('/').filter(Boolean)
  if (raw.length === 0) return { kind: 'known' }

  // A path segment that had to be percent-encoded is not a handle, a slug, or
  // one of our static segments. Decode failures included.
  if (raw.some((s) => s.includes('%'))) return { kind: 'unknown' }

  // Handles and slugs are stored lowercase and the registry resolves a URL
  // case-insensitively (`canonAuthor`), so `/GTM` reaches the same profile as
  // `/gtm`. Classify on the lowercased form or those URLs would 404 here while
  // still rendering fine.
  const segments = raw.map((s) => s.toLowerCase())
  const [first, second, third, ...rest] = segments

  if (first === 'browse') {
    if (segments.length === 1) return { kind: 'known' }
    if (segments.length === 2 && browseSegments().has(second!)) return { kind: 'known' }
    return { kind: 'unknown' }
  }

  // /news is the Daily; /news/<topic> is one category room. Only real category
  // keys resolve. Decided here rather than with notFound() in the page because
  // the PPR shell has already put a 200 on the wire by render time, which turns
  // an unknown topic into a soft-404 (404 body, 200 status).
  if (first === 'news') {
    if (segments.length === 1) return { kind: 'known' }
    // /news/topic/<category> is a browse room; /news/<slug> is one story.
    // Stories take the shorter path because a story is the thing worth sending
    // to someone. A story slug cannot be enumerated here without the blog store
    // (which proxy.ts cannot reach), so the shape resolves and the page's own
    // notFound handles a miss — see the story route for why that is acceptable
    // there and not for a guessed handle.
    if (segments.length === 2) {
      if (second === 'rss.xml') return { kind: 'known' }
      return { kind: 'known' }
    }
    if (segments.length === 3 && second === 'topic' && isCategoryKey(third)) {
      return { kind: 'known' }
    }
    return { kind: 'unknown' }
  }

  if (first === 'docs') {
    return docsPaths().has(`/${segments.join('/')}`) ? { kind: 'known' } : { kind: 'unknown' }
  }

  // RFC 8615 space. Only the suffixes we actually publish resolve; every other
  // probe here (`/.well-known/security.txt`, `/.well-known/openapi.json`, …)
  // must say so rather than answer the app shell. The per-skill artifact route
  // is `known` because its own handler 404s an unpublished name correctly —
  // deciding that here would need the filesystem, which proxy.ts does not have.
  if (first === '.well-known') {
    if (pathnameIsWellKnown(segments)) return { kind: 'known' }
    return { kind: 'unknown' }
  }

  if (KNOWN_TOP_LEVEL_SEGMENTS.has(first!)) return { kind: 'known' }

  // Everything below is the owner-first permalink space (see lib/urls.ts):
  //   /{owner}                    profile
  //   /{owner}/{followers|following|installs}
  //   /{owner}/kit[/{slug}[/edit]]
  //   /{owner}/{skill}[/{edit|propose|review}]
  if (!HANDLE_RE.test(first!)) return { kind: 'unknown' }

  if (segments.length === 1) return { kind: 'registry', check: { type: 'author', author: first! } }

  if (RESERVED_SKILL_SLUGS.has(second!)) {
    if (second === 'kit') {
      if (segments.length === 2) {
        return { kind: 'registry', check: { type: 'author', author: first! } }
      }
      if (!SKILL_SLUG_RE.test(third!)) return { kind: 'unknown' }
      // `summon` is the kit's agent surface (a JSON route handler, not a page),
      // sibling to `edit`. Both resolve only if the kit itself does.
      if (
        segments.length === 3 ||
        (segments.length === 4 && (rest[0] === 'edit' || rest[0] === 'summon'))
      ) {
        return { kind: 'registry', check: { type: 'kit', owner: first!, slug: third! } }
      }
      return { kind: 'unknown' }
    }
    // followers / following / installs / summon — length-2 only. The first
    // three are profile sub-pages; `summon` is the handle's agent surface.
    if (segments.length === 2) {
      return { kind: 'registry', check: { type: 'author', author: first! } }
    }
    return { kind: 'unknown' }
  }

  if (!SKILL_SLUG_RE.test(second!)) return { kind: 'unknown' }
  if (segments.length === 2 || (segments.length === 3 && SKILL_SUBPAGES.has(third!))) {
    return { kind: 'registry', check: { type: 'skill', author: first!, slug: second! } }
  }
  return { kind: 'unknown' }
}

/**
 * Paths that have a Markdown representation, for `Accept: text/markdown`
 * negotiation. Shape-based so `proxy.ts` can decide without a lookup: when the
 * resource turns out not to exist the Markdown route answers 404 in Markdown,
 * which is the right answer either way.
 */
export function hasMarkdownVariant(pathname: string): boolean {
  if (pathname === '/') return true
  const verdict = classifyRoute(pathname)
  if (verdict.kind === 'unknown') return false
  if (pathname === '/docs' || pathname.startsWith('/docs/')) {
    return !DOCS_WITHOUT_MARKDOWN.has(pathname)
  }
  if (pathname === '/blog' || pathname.startsWith('/blog/')) return true
  if (pathname === '/browse') return true
  if (verdict.kind !== 'registry') return false
  // Only the canonical permalinks: `/{owner}` and `/{owner}/{skill}`. A profile
  // sub-page or a kit page classifies as an author lookup too, and serving it
  // the profile's Markdown would answer a different question than the URL asked.
  const depth = pathname.slice(1).split('/').filter(Boolean).length
  if (verdict.check.type === 'author') return depth === 1
  return verdict.check.type === 'skill' && depth === 2
}
