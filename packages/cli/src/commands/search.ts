import type { Command } from "commander";
import { REGISTRY_API, listRouteManifest } from "@skillet/core";
import { CLI_VERSION, resolveRegistryUrl } from "../cli-context.js";
import { webBaseUrl } from "../cli-command-tier.js";
import { stripControlChars } from "../sanitize-output.js";
import { writeJsonOk, writeJsonError } from "../json-output.js";
import { ExitCode, exitWith } from "../exit-codes.js";
import { bold, cyan, dim, fail } from "../cli-colors.js";

/**
 * `skillet search <keyword...>` — public, anonymous registry search.
 *
 * The router's registry fall-through (@skillet/route) calls this on a whiff to
 * turn "no local skill fits" into named, installable suggestions. It is also a
 * standalone command: a person can search the library from the terminal.
 *
 * Transport is a plain `fetch`, NOT the RegistryClient — the client attaches
 * `x-skillet-machine-id` to every request, and search keywords must stay
 * unlinked from device identity. The registry endpoint is public and needs no
 * auth. The only headers sent are the client version and, for router-driven
 * calls, a fixed content-free source marker.
 */

/** Hard caps. One positional = one literal query = one request. */
export const MAX_QUERIES = 3;
export const MAX_KEYWORD_LEN = 64;

/** One merged, ranked suggestion the router can render without a second call. */
export interface SearchResult {
  /** Exact `@author/slug` — usable verbatim as the `skillet add` argument. */
  ref: string;
  description: string | null;
  install_count: number;
  /** Highest per-query tier score this ref earned (within-query tiebreak only). */
  score: number;
  category: string | null;
  /** Absolute skill URL, so a suggestion is clickable. */
  url: string;
  /** True when the ref is already in the local kit — the router filters these. */
  installed: boolean;
}

export interface SearchOutcome {
  results: SearchResult[];
  /** Queries that rejected or returned non-2xx. */
  failedQueries: number;
  /** The exact queries actually sent (post-sanitization, empties dropped). */
  sentQueries: string[];
}

interface RegistrySkillRow {
  author?: unknown;
  slug?: unknown;
  description?: unknown;
  install_count?: unknown;
  score?: unknown;
  category?: unknown;
}

interface SearchDeps {
  fetchImpl: typeof fetch;
  registryUrl: string;
  webUrl: string;
  /** Local-kit refs, lowercased, for a case-insensitive installed check. */
  installedRefs: Set<string>;
  /** Fixed marker slug (e.g. `route-skill`); sent on the first request only. */
  source?: string;
  /** Per-request `limit` forwarded to the registry (registry clamps 1..25). */
  limit?: number;
}

/**
 * Sanitize one keyword before it leaves the machine. Strips terminal control
 * chars, collapses whitespace, trims, and caps length — a mechanical backstop
 * independent of whatever composed the keyword (the router's distillation step
 * is prompt-level; this is not). Returns null when nothing survives.
 */
export function sanitizeKeyword(raw: string): string | null {
  const cleaned = stripControlChars(raw).replace(/\s+/g, " ").trim().slice(0, MAX_KEYWORD_LEN);
  return cleaned === "" ? null : cleaned;
}

/**
 * Sanitize each keyword, lowercase to the registry's own match form, drop
 * empties, and dedup (the registry lowercases `q`, so "Blog" and "blog" are the
 * same query — sending both fires a redundant request and double-counts the ref
 * in match-breadth ranking). The lowercased form is the canonical set of queries
 * a search sends.
 */
export function prepareQueries(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const kw = sanitizeKeyword(r);
    if (kw === null) continue;
    const canonical = kw.toLowerCase();
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

interface Accum {
  ref: string;
  description: string | null;
  install_count: number;
  score: number;
  category: string | null;
  url: string;
  matchCount: number;
}

interface QueryResult {
  failed: boolean;
  rows: RegistrySkillRow[];
}

async function fetchQuery(q: string, withSource: boolean, deps: SearchDeps): Promise<QueryResult> {
  const params = new URLSearchParams({ q, types: "skills" });
  if (deps.limit !== undefined) params.set("limit", String(deps.limit));
  const url = `${deps.registryUrl}${REGISTRY_API}/search?${params.toString()}`;
  const headers: Record<string, string> = { "x-skillet-client-version": CLI_VERSION };
  if (withSource && deps.source !== undefined) headers["x-skillet-search-source"] = deps.source;

  try {
    const res = await deps.fetchImpl(url, { headers });
    // A 429 (rate limit) or 5xx body has no `groups` key; reading it as zero
    // results would masquerade as "library has nothing". Treat non-2xx as a
    // failed query, distinct from an honest empty result.
    if (!res.ok) return { failed: true, rows: [] };
    const body = (await res.json()) as { groups?: { skills?: unknown } };
    const rows = Array.isArray(body?.groups?.skills)
      ? (body.groups!.skills as RegistrySkillRow[])
      : [];
    return { failed: false, rows };
  } catch {
    return { failed: true, rows: [] };
  }
}

/**
 * Run each keyword as its own request (in parallel) and merge client-side. The
 * registry matches a query as ONE literal substring with no tokenization, so
 * distinct keywords are fanned out here; a single multi-word phrase is the
 * router's to avoid composing.
 *
 * Ranking: match breadth first (how many of the issued queries returned a ref),
 * then the registry's own relevance tier `score`, then `install_count`. Score
 * beats installs because within a query it encodes exact-name > slug >
 * description — the single-keyword case (the router's common path) would
 * otherwise let a popular tangential description-match bury an exact-name hit.
 *
 * The source marker rides only the FIRST request, so the registry counts one
 * event per search invocation (a demand signal), not one per fanned-out keyword.
 */
export async function runSearch(keywords: string[], deps: SearchDeps): Promise<SearchOutcome> {
  const sentQueries = prepareQueries(keywords);

  const perQuery = await Promise.all(
    sentQueries.map((q, i) => fetchQuery(q, i === 0, deps)),
  );

  const byRef = new Map<string, Accum>();
  let failedQueries = 0;

  for (const result of perQuery) {
    if (result.failed) {
      failedQueries += 1;
      continue;
    }
    for (const row of result.rows) {
      const author = typeof row.author === "string" ? row.author : null;
      const slug = typeof row.slug === "string" ? row.slug : null;
      if (author === null || slug === null) continue;
      // Author/slug are untrusted third-party content (R11), same as description
      // and category — strip terminal escapes before they reach the ref/url that
      // print to the terminal and become the copy-pasted `skillet add` argument.
      const safeAuthor = stripControlChars(author);
      const safeSlug = stripControlChars(slug);
      const ref = `@${safeAuthor}/${safeSlug}`;
      const score = typeof row.score === "number" ? row.score : 0;
      const existing = byRef.get(ref);
      if (existing) {
        existing.matchCount += 1;
        if (score > existing.score) existing.score = score;
      } else {
        byRef.set(ref, {
          ref,
          description:
            typeof row.description === "string" ? stripControlChars(row.description) : null,
          install_count: typeof row.install_count === "number" ? row.install_count : 0,
          score,
          category: typeof row.category === "string" ? stripControlChars(row.category) : null,
          url: `${deps.webUrl}/${safeAuthor}/${safeSlug}`,
          matchCount: 1,
        });
      }
    }
  }

  const results: SearchResult[] = [...byRef.values()]
    .sort(
      (a, b) =>
        b.matchCount - a.matchCount ||
        b.score - a.score ||
        b.install_count - a.install_count ||
        a.ref.localeCompare(b.ref),
    )
    .map((a) => ({
      ref: a.ref,
      description: a.description,
      install_count: a.install_count,
      score: a.score,
      category: a.category,
      url: a.url,
      // Case-insensitive: the local kit ref and the registry handle can differ
      // in case; an exact-string miss would re-suggest an installed skill.
      installed: deps.installedRefs.has(a.ref.toLowerCase()),
    }));

  return { results, failedQueries, sentQueries };
}

function renderHuman(outcome: SearchOutcome): void {
  if (outcome.sentQueries.length === 0) {
    console.log("No searchable keywords.");
    return;
  }
  if (outcome.results.length === 0) {
    console.log("Nothing in the library matches.");
    if (outcome.failedQueries > 0) {
      console.log(dim(`(${outcome.failedQueries} of ${outcome.sentQueries.length} queries failed)`));
    }
    return;
  }
  for (const r of outcome.results) {
    const tag = r.installed ? dim(" (in your kit)") : "";
    console.log(`${bold(r.ref)}${tag}`);
    if (r.description) console.log(`  ${r.description}`);
    console.log(dim(`  ${r.install_count} installs  ${cyan(r.url)}`));
  }
  if (outcome.failedQueries > 0) {
    console.log(dim(`\n${outcome.failedQueries} of ${outcome.sentQueries.length} queries failed.`));
  }
}

export function registerSearchCommand(program: Command): void {
  program
    .command("search")
    .argument("<keyword...>", "One or more capability keywords (each is one library search)")
    .description("Search the public skill library")
    .option("--json", "Emit machine-readable results")
    .option("--source <slug>", "Fixed source marker for router-driven calls")
    .option("--limit <n>", "Results per query (registry-clamped 1..25)")
    .action(
      async (
        keywords: string[],
        opts: { json?: boolean; source?: string; limit?: string },
      ) => {
        const asJson = opts.json === true;
        // Cap on the real query count (post-sanitize, post-dedup), so a trailing
        // blank or a repeated keyword doesn't trip the limit on a valid search.
        const queries = prepareQueries(keywords);
        if (queries.length > MAX_QUERIES) {
          if (asJson) {
            writeJsonError(`At most ${MAX_QUERIES} keywords per search.`, {
              code: "too_many_queries",
              exitCode: ExitCode.USAGE,
            });
          }
          console.error(`At most ${MAX_QUERIES} keywords per search.`);
          exitWith(ExitCode.USAGE);
        }

        // All keywords sanitized away (blank/punctuation-only) is a usage
        // error, same as too many keywords, not an honest empty result.
        if (queries.length === 0) {
          if (asJson) {
            writeJsonError("No searchable keywords.", {
              code: "no_keywords",
              exitCode: ExitCode.USAGE,
            });
          }
          console.error("No searchable keywords.");
          exitWith(ExitCode.USAGE);
        }

        // Strict digits: parseInt("10x") truncates to 10 — reject the typo as a
        // usage error rather than silently searching a different limit.
        let limit: number | undefined;
        if (opts.limit !== undefined) {
          const raw = opts.limit.trim();
          if (!/^\d+$/.test(raw)) {
            const msg = `--limit must be a positive integer, got "${opts.limit}"`;
            if (asJson) {
              writeJsonError(msg, { code: "invalid_limit", exitCode: ExitCode.USAGE });
            }
            console.error(fail(msg));
            exitWith(ExitCode.USAGE);
            return;
          }
          limit = Number.parseInt(raw, 10);
        }
        const [registryUrl, manifest] = await Promise.all([
          resolveRegistryUrl(),
          listRouteManifest().catch(() => []),
        ]);
        // Lowercased for a case-insensitive installed check (see runSearch).
        const installedRefs = new Set(manifest.map((e) => e.skillRef.toLowerCase()));

        const outcome = await runSearch(keywords, {
          fetchImpl: fetch,
          registryUrl,
          webUrl: webBaseUrl(),
          installedRefs,
          source: opts.source,
          limit: Number.isFinite(limit) ? (limit as number) : undefined,
        });

        // Every query failed → this is an error, not an honest empty result.
        if (outcome.sentQueries.length > 0 && outcome.failedQueries === outcome.sentQueries.length) {
          if (asJson) {
            writeJsonError("Every search query failed.", {
              code: "search_failed",
              exitCode: ExitCode.ERROR,
            });
          }
          console.error("Every search query failed; the registry may be unreachable.");
          exitWith(ExitCode.ERROR);
        }

        if (asJson) {
          writeJsonOk({
            results: outcome.results,
            failedQueries: outcome.failedQueries,
            queries: outcome.sentQueries,
          });
          return;
        }
        renderHuman(outcome);
      },
    );
}
