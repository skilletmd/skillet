// Query matching for registry search: normalize, tokenize, score.
//
// Search used to hand the whole query string to a single Prisma `contains` and
// score it the same way, so `web design` never found `web-design-guidelines` —
// slugs are hyphenated and few descriptions carry the exact phrase. Everything
// here is pure so the ranking contract is covered by hermetic tests rather than
// only by the MySQL-gated suites.
//
// The scoring tiers are unchanged from the whole-string era. A single-token
// query scores exactly what it scored before: the phrase branch and the token
// branch collapse onto the same value, which is the regression boundary for
// this change.

/** Query equals a primary field. */
export const SCORE_EXACT = 1.0
/** Query is a prefix of a primary field. */
export const SCORE_PREFIX = 0.75
/** Query occurs in a primary field. */
export const SCORE_NAME = 0.5
/** Query occurs only in a secondary field. */
export const SCORE_DESC = 0.25

/** The summon router can pass a whole sentence; past this the words are noise. */
const MAX_TOKENS = 8

/**
 * One-character tokens match nearly every description without adding signal.
 * Two is the floor rather than an English stopword list, which would mis-drop
 * `go`, `ai`, `js`, and `md` — all real search terms in this catalog.
 */
const MIN_TOKEN_LENGTH = 2

/**
 * Below this length a needle must land on a word boundary instead of anywhere
 * in the text. Substring matching is right for a real word — `lint` should find
 * `eslint-config` — but ruinous for a fragment: `ai` matches "explain" and
 * "maintain", `c` matches "documentation", and the useful hits drown.
 *
 * Boundary matching keeps what people actually mean by a short query: `x` finds
 * `twitter-x` and `x-poster`, `go` finds `golang` and not `django`.
 *
 * Three is the floor because the tier below it is where the noise lives; raising
 * it further would break substring matches people rely on (`web` → `webhooks`).
 */
const MIN_SUBSTRING_LENGTH = 3

/**
 * Lowercase, and collapse every run of non-alphanumerics to a single space.
 * Unicode-aware: descriptions and display names are not all ASCII, and
 * stripping their letters outright would make those rows unsearchable.
 *
 * This is what makes `web design` match `web-design-guidelines` without a
 * special hyphen case — both sides land in the same space-separated form.
 */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Lowercased, trimmed, but otherwise untouched — used only for degenerate queries. */
function rawText(value: string): string {
  return value.trim().toLowerCase()
}

/**
 * The words a query matches on: normalized, short tokens dropped, capped.
 *
 * A query that normalizes to nothing (pure punctuation) keeps the raw trimmed
 * string as one token, so it behaves as it always did instead of becoming a
 * zero-token query that matches everything.
 */
export function queryTokens(query: string): string[] {
  const normalized = normalizeText(query)
  if (normalized === '') {
    const raw = rawText(query)
    return raw === '' ? [] : [raw]
  }
  const all = normalized.split(' ').filter(Boolean)
  // Keep the short tokens when they are all there is: `go ai` is a real query.
  const long = all.filter((t) => t.length >= MIN_TOKEN_LENGTH)
  return (long.length > 0 ? long : all).slice(0, MAX_TOKENS)
}

/** A query prepared once and reused across every candidate row. */
export interface QueryMatcher {
  /** The words to match, in query order. */
  tokens: string[]
  /** The normalized whole query, for the exact/prefix tiers. */
  phrase: string
  /** True when the query held no letters or digits (see {@link queryTokens}). */
  degenerate: boolean
}

/** Prepare a raw, un-lowercased query for matching. */
export function buildMatcher(query: string): QueryMatcher {
  const phrase = normalizeText(query)
  const degenerate = phrase === ''
  return {
    tokens: queryTokens(query),
    phrase: degenerate ? rawText(query) : phrase,
    degenerate,
  }
}

type Field = string | null | undefined

/** One searchable field, kept both whole and split into words. */
interface Haystack {
  text: string
  words: string[]
}

function haystack(fields: readonly Field[], matcher: QueryMatcher): Haystack[] {
  const out: Haystack[] = []
  for (const field of fields) {
    if (!field) continue
    const text = matcher.degenerate ? rawText(field) : normalizeText(field)
    if (text !== '') out.push({ text, words: text.split(' ').filter(Boolean) })
  }
  return out
}

/**
 * Does `needle` appear in this field?
 *
 * Long needles match anywhere; short ones must start a word (see
 * {@link MIN_SUBSTRING_LENGTH}). A degenerate query carries no words to anchor
 * to, so it keeps plain substring matching.
 */
function occursIn(hay: Haystack, needle: string, degenerate: boolean): boolean {
  if (degenerate || needle.length >= MIN_SUBSTRING_LENGTH) return hay.text.includes(needle)
  return hay.words.some((word) => word.startsWith(needle))
}

/** Exact/prefix/contains against the whole query, or null when it does not appear. */
function phraseScore(
  matcher: QueryMatcher,
  primary: Haystack[],
  secondary: Haystack[],
): number | null {
  const { phrase, degenerate } = matcher
  if (phrase === '') return null
  if (primary.some((h) => h.text === phrase)) return SCORE_EXACT
  if (primary.some((h) => h.text.startsWith(phrase))) return SCORE_PREFIX
  if (primary.some((h) => occursIn(h, phrase, degenerate))) return SCORE_NAME
  if (secondary.some((h) => occursIn(h, phrase, degenerate))) return SCORE_DESC
  return null
}

/**
 * Mean per-token tier: a token in a primary field is worth {@link SCORE_NAME},
 * a token only in a secondary field {@link SCORE_DESC}, a miss zero.
 *
 * Taking the mean is what makes a result matching every word outrank one
 * matching half of them, without a separate coverage term.
 */
function tokenScore(matcher: QueryMatcher, primary: Haystack[], secondary: Haystack[]): number {
  const { tokens, degenerate } = matcher
  if (tokens.length === 0) return 0
  let total = 0
  for (const token of tokens) {
    if (primary.some((h) => occursIn(h, token, degenerate))) total += SCORE_NAME
    else if (secondary.some((h) => occursIn(h, token, degenerate))) total += SCORE_DESC
  }
  return total / tokens.length
}

/**
 * Score one candidate row, or null when nothing in it matched.
 *
 * `primary` fields are the identity of the row (a slug, a handle, a name);
 * `secondary` fields are prose about it (a description, a bio).
 */
export function matchScore(
  matcher: QueryMatcher,
  primary: readonly Field[],
  secondary: readonly Field[],
): number | null {
  const prim = haystack(primary, matcher)
  const sec = haystack(secondary, matcher)
  const score = Math.max(phraseScore(matcher, prim, sec) ?? 0, tokenScore(matcher, prim, sec))
  return score > 0 ? score : null
}

/**
 * Does every word of the query appear somewhere in these fields?
 *
 * The boolean counterpart of {@link matchScore}, for the catalog list endpoints:
 * they page and count over a SQL filter, so they narrow rather than rank. An
 * empty query is not a filter and matches everything.
 */
export function matchesEveryToken(matcher: QueryMatcher, fields: readonly Field[]): boolean {
  if (matcher.tokens.length === 0) return true
  const hays = haystack(fields, matcher)
  return matcher.tokens.every((token) =>
    hays.some((hay) => occursIn(hay, token, matcher.degenerate)),
  )
}

/** One `OR`-across-columns clause per token, for a Prisma `where`. */
type ColumnFilter = { contains: string } | { startsWith: string }
export type TokenClause<C extends string> = {
  OR: { [K in C]?: ColumnFilter }[]
}

/**
 * SQL candidacy filters for one token against one column.
 *
 * A long token matches anywhere. A short one is asked for at a word boundary
 * here too, not just in the scorer: candidacy is capped at a few hundred rows
 * ordered by installs, so a permissive `LIKE '%c%'` would fill that budget with
 * rows the scorer then throws away and truncate the real matches out of the
 * result before it ever sees them.
 *
 * Only `-` and a space are used as boundary markers. `_` is a `LIKE` wildcard
 * meaning "any character" and Prisma does not escape it, so `'_c'` would match
 * every row with a `c` in it. Slugs are dash-separated anyway (`slugify`
 * collapses every other run to `-`), so nothing is lost.
 */
function columnFilters(token: string): ColumnFilter[] {
  if (token.length >= MIN_SUBSTRING_LENGTH) return [{ contains: token }]
  return [{ startsWith: token }, { contains: `-${token}` }, { contains: ` ${token}` }]
}

/**
 * Per-token candidacy clauses. Callers combine them two ways: `AND` for the
 * every-token pass, and a flattened `OR` for the any-token fallback.
 *
 * Tokens are matched against raw columns, not normalized ones — SQL cannot
 * normalize, so these stay a superset of what the scorer accepts and precision
 * comes from scoring.
 */
export function tokenClauses<C extends string>(
  matcher: QueryMatcher,
  columns: readonly C[],
): TokenClause<C>[] {
  return matcher.tokens.map((token) => ({
    OR: columns.flatMap((column) =>
      // A degenerate query has no words to anchor to; match it literally.
      (matcher.degenerate ? [{ contains: token }] : columnFilters(token)).map(
        (filter) => ({ [column]: filter }) as TokenClause<C>['OR'][number],
      ),
    ),
  }))
}
