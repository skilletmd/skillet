/**
 * HTTP content negotiation between the HTML a browser wants and the Markdown an
 * agent wants, per the acceptmarkdown.com convention (RFC 9110 §12.5.1 for the
 * ranking rules, RFC 7763 for the `text/markdown` media type).
 *
 * The four things a compliant origin has to get right:
 *   1. serve Markdown for `Accept: text/markdown`
 *   2. set `Vary: Accept` so a CDN can't hand the HTML variant to an agent
 *   3. `406` when the client can accept nothing we produce
 *   4. honor q-values, including `q=0` as an explicit refusal
 *
 * Pure functions with no Next imports so they can be unit-tested directly and
 * used from `proxy.ts`, which runs before any route module loads.
 */

/** The representations this origin can produce, most-preferred first. */
export const PRODUCES = ['text/html', 'text/markdown'] as const
export type Produced = (typeof PRODUCES)[number]

export const MARKDOWN_CONTENT_TYPE = 'text/markdown; charset=utf-8'

type AcceptEntry = { type: string; q: number; specificity: number }

function parseAccept(header: string): AcceptEntry[] {
  return header
    .split(',')
    .map((raw) => {
      const parts = raw
        .trim()
        .split(';')
        .map((s) => s.trim())
      const type = (parts[0] ?? '').toLowerCase()
      let q = 1
      for (const param of parts.slice(1)) {
        const [name, value] = param.split('=').map((s) => s.trim())
        if (name?.toLowerCase() === 'q') {
          const parsed = Number(value)
          if (!Number.isNaN(parsed)) q = Math.max(0, Math.min(1, parsed))
        }
      }
      // `*/*` (0) loses to `text/*` (1), which loses to `text/markdown` (2).
      const specificity = type === '*/*' ? 0 : type.endsWith('/*') ? 1 : 2
      return { type, q, specificity }
    })
    .filter((entry) => entry.type.length > 0)
}

function matches(entry: AcceptEntry, candidate: string): boolean {
  if (entry.type === '*/*') return true
  if (entry.type.endsWith('/*')) return candidate.startsWith(entry.type.slice(0, -1))
  return entry.type === candidate
}

/**
 * The representation to serve, or `null` when the client accepts none of them.
 *
 * An absent or unparseable `Accept` means "no preference": HTML, the same thing
 * every browser without an opinion already gets.
 */
export function preferredType(header: string | null | undefined): Produced | null {
  if (!header || !header.trim()) return PRODUCES[0]
  const entries = parseAccept(header)
  if (entries.length === 0) return PRODUCES[0]

  let bestType: Produced | null = null
  let bestQ = -1
  let bestPosition = Infinity

  for (const candidate of PRODUCES) {
    // Per RFC 9110 §12.5.1 the MOST SPECIFIC matching range wins regardless of
    // q, so `text/html;q=0, */*` correctly refuses HTML instead of letting the
    // wildcard resurrect it.
    let matched: AcceptEntry | null = null
    let matchedPosition = Infinity
    for (let idx = 0; idx < entries.length; idx++) {
      const e = entries[idx]!
      if (!matches(e, candidate)) continue
      if (
        matched === null ||
        e.specificity > matched.specificity ||
        (e.specificity === matched.specificity && idx < matchedPosition)
      ) {
        matched = e
        matchedPosition = idx
      }
    }
    if (matched === null) continue
    if (matched.q <= 0) continue // explicit refusal

    // Across candidates: highest q wins, ties break on client order so
    // `text/markdown, text/html` picks Markdown.
    if (matched.q > bestQ || (matched.q === bestQ && matchedPosition < bestPosition)) {
      bestQ = matched.q
      bestPosition = matchedPosition
      bestType = candidate
    }
  }

  return bestType
}

/** True when the client asked for Markdown over HTML. */
export function wantsMarkdown(header: string | null | undefined): boolean {
  return preferredType(header) === 'text/markdown'
}

/**
 * True when the client can accept nothing we produce, which is the one case
 * that earns a 406. An absent Accept never does — `preferredType` defaults it
 * to HTML.
 */
export function isNotAcceptable(header: string | null | undefined): boolean {
  return Boolean(header && header.trim()) && preferredType(header) === null
}

/** Extensions that name one concrete artifact, never an HTML/Markdown document. */
const SINGLE_REPRESENTATION_EXTENSIONS = [
  '.json',
  '.txt',
  '.xml',
  '.ico',
  '.svg',
  '.png',
  '.webmanifest',
]

/** Route prefixes that serve installers/manifests rather than documents. */
const SINGLE_REPRESENTATION_PREFIXES = ['/desktop', '/download']

/**
 * True for a path that has exactly ONE representation, so content negotiation
 * must not run over it.
 *
 * These routes produce a concrete artifact (the updater manifest, llms.txt, the
 * sitemap, an installer redirect) and have no Markdown twin, so negotiating can
 * only reject a caller that asked for the very type the route returns. That is
 * not hypothetical: `tauri-plugin-updater` requests its manifest with
 * `Accept: application/json`, which matches neither entry in PRODUCES, so
 * `/desktop/latest.json` answered 406 to every installed desktop app and
 * auto-update never ran once for anybody.
 *
 * `.md` is deliberately excluded — it IS a negotiated representation and is
 * handled by the explicit `.md` branch in agentSurfaceResponse.
 */
export function isSingleRepresentationPath(pathname: string): boolean {
  if (pathname.endsWith('.md')) return false
  if (SINGLE_REPRESENTATION_EXTENSIONS.some((ext) => pathname.endsWith(ext))) return true
  return SINGLE_REPRESENTATION_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/**
 * Add `Accept` to an existing `Vary` without disturbing what is already there.
 *
 * Next sets its own RSC-routing tokens on `Vary`; clobbering them breaks client
 * navigation caching, so this appends rather than assigns.
 */
export function appendVaryAccept(headers: Headers): void {
  const existing = headers.get('Vary')
  if (!existing) {
    headers.set('Vary', 'Accept')
    return
  }
  const tokens = existing.split(',').map((s) => s.trim().toLowerCase())
  if (tokens.includes('*') || tokens.includes('accept')) return
  headers.set('Vary', `${existing}, Accept`)
}

/** The body of a spec-correct 406, listing what this origin can produce. */
export const NOT_ACCEPTABLE_BODY = `Not Acceptable\n\nAvailable representations: ${PRODUCES.join(', ')}\n`

/**
 * The `Link` header that advertises the Markdown twin (RFC 8288 + RFC 7763).
 *
 * `Vary: Accept` tells a cache that the representation depends on `Accept`. It
 * does not tell a CLIENT that a second representation exists — an agent had to
 * already know the acceptmarkdown.com convention to try for it, so the clean,
 * JavaScript-free version of every page on this site was invisible to anything
 * that did not guess. This says it outright, at the same URL, in a header a
 * non-HTML-parsing client can read.
 */
export function markdownAlternateLink(absoluteUrl: string): string {
  return `<${absoluteUrl}>; rel="alternate"; type="text/markdown"`
}

/**
 * What a caller asked for with `?full=`, as three states rather than two.
 *
 * `undefined` means they did not ask, which is NOT the same as asking for the
 * small form: it hands the decision to the surface, which sizes the response to
 * the resource. Only an explicit value overrides that.
 *
 * Lenient on the value, because an agent that writes `?full=true` or a bare
 * `?full` meant `?full=1`, and refusing those would make the flag feel broken.
 */
export function fullRequested(raw: string | null | undefined): boolean | undefined {
  if (raw == null) return undefined
  const value = raw.trim().toLowerCase()
  if (value === '') return true
  return value !== '0' && value !== 'false' && value !== 'no'
}
