/**
 * Summon: route against a handle's PUBLIC kit, fetched live.
 *
 * Deliberately anonymous. Summon is the surface someone reaches with nothing
 * installed, no sync, and no account, so this uses plain `fetch` against the
 * public endpoints rather than the authenticated RegistryClient. Adding a token
 * path here would quietly make the feature depend on pairing.
 *
 * Until now this flow lived only as prose in the router's SKILL.md, which meant
 * every summon spent the model's turn budget re-reading how to make two HTTP
 * calls. The verb owns it instead; the skill body just says which verb to call.
 */
import { REGISTRY_API } from "../registry-api.js";
import { REGISTRY_URL_DEFAULT } from "../kit/types.js";

export interface SummonCandidate {
  /** Canonical `@author/slug` of the TRUE author, never the summoned handle. */
  ref: string;
  description: string | null;
  latestHash: string;
  /** The curating handle when this is a saved pick, else null. */
  via: string | null;
}

export type SummonResult =
  | { kind: "ok"; handle: string; candidates: SummonCandidate[] }
  /** The handle has no public kit, or publishes nothing public. Not an error. */
  | { kind: "no-kit"; handle: string }
  /** No outbound access, or the registry is down. Callers fall back locally. */
  | { kind: "unreachable"; handle: string; reason: string };

function base(): string {
  return (process.env["SKILLET_REGISTRY_URL"] ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, "");
}

/** `@handle` and `handle` both accept; the API wants the bare form. */
function bareHandle(handle: string): string {
  return handle.trim().replace(/^@/, "");
}

/**
 * Whether to send the summon marker that moves the author's public count.
 *
 * Opting out of activity opts out of crediting too. The alternative is
 * crediting an author for a read the user asked us not to record, which is a
 * worse default than a slightly undercounted total.
 */
function marksActivity(): boolean {
  const env = process.env["SKILLET_ACTIVITY"];
  return env !== "0" && env !== "false";
}

async function getJson(url: string): Promise<{ ok: true; body: unknown } | { ok: false; status: number | null; reason: string }> {
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
    return { ok: true, body: (await res.json()) as unknown };
  } catch (err) {
    return { ok: false, status: null, reason: err instanceof Error ? err.message : "request failed" };
  }
}

function readCandidates(body: unknown): SummonCandidate[] {
  const skills = (body as { skills?: unknown })?.skills;
  if (!Array.isArray(skills)) return [];
  const out: SummonCandidate[] = [];
  for (const raw of skills) {
    const s = raw as Record<string, unknown>;
    const ref = typeof s["ref"] === "string" ? s["ref"] : null;
    const hash = typeof s["latest_hash"] === "string" ? s["latest_hash"] : null;
    // A candidate without a hash cannot be loaded at a pinned version, so it is
    // not a routable candidate however good its description looks.
    if (!ref || !hash) continue;
    out.push({
      ref: ref.startsWith("@") ? ref : `@${ref}`,
      description: typeof s["description"] === "string" ? s["description"] : null,
      latestHash: hash,
      via: typeof s["via"] === "string" && s["via"] ? s["via"] : null,
    });
  }
  return out;
}

/** Fetch a handle's public summon set. */
export async function summonHandle(handle: string): Promise<SummonResult> {
  const h = bareHandle(handle);
  if (!h) return { kind: "no-kit", handle };
  const res = await getJson(`${base()}${REGISTRY_API}/authors/${encodeURIComponent(h)}/summon`);
  if (!res.ok) {
    // 404 is "no public kit", a normal answer. Anything else is infrastructure,
    // and the caller falls back to the local kit rather than inventing a skill.
    if (res.status === 404) return { kind: "no-kit", handle: h };
    return { kind: "unreachable", handle: h, reason: res.reason };
  }
  const candidates = readCandidates(res.body);
  return candidates.length === 0
    ? { kind: "no-kit", handle: h }
    : { kind: "ok", handle: h, candidates };
}

/** Below this the registry's relevance tier is a shared-word coincidence. */
export const RELEVANCE_FLOOR = 0.5;

/** How many ranked candidates are worth a hash lookup each. */
const MAX_CANDIDATES = 3;

interface SearchHit {
  ref: string;
  description: string | null;
  score: number;
  installs: number;
  /** How many of the issued keyword queries returned this ref. */
  matches: number;
}

/**
 * Read `/search`, which answers a DIFFERENT shape from `/authors/:h/summon`:
 * rows live under `groups.skills`, and they carry `author`/`slug` rather than a
 * `ref`, with no `latest_hash` at all. `readCandidates` is built for the summon
 * shape and drops everything here, so this needs its own reader.
 */
function readSearchHits(body: unknown): SearchHit[] {
  const rows = ((body as { groups?: { skills?: unknown } })?.groups?.skills) as unknown;
  if (!Array.isArray(rows)) return [];
  const out: SearchHit[] = [];
  for (const raw of rows) {
    const s = raw as Record<string, unknown>;
    const author = typeof s["author"] === "string" ? s["author"] : null;
    const slug = typeof s["slug"] === "string" ? s["slug"] : null;
    if (!author || !slug) continue;
    out.push({
      ref: `@${author}/${slug}`,
      description: typeof s["description"] === "string" ? s["description"] : null,
      score: typeof s["score"] === "number" ? s["score"] : 0,
      installs: typeof s["install_count"] === "number" ? s["install_count"] : 0,
      matches: 1,
    });
  }
  return out;
}

/** The version `route use --hash` pins to. Search rows do not carry one. */
async function latestHashFor(ref: string): Promise<string | null> {
  const m = /^@?([^/@\s]+)\/([^/\s]+)$/.exec(ref);
  if (!m) return null;
  const url = `${base()}${REGISTRY_API}/skills/${encodeURIComponent(m[1]!)}/${encodeURIComponent(m[2]!)}`;
  const res = await getJson(url);
  if (!res.ok) return null;
  const hash = (res.body as { latest_hash?: unknown })?.latest_hash;
  return typeof hash === "string" && hash ? hash : null;
}

/**
 * Cross-author search, for when the named handle has nothing that fits, and for
 * a kit that is empty or has nothing fitting.
 *
 * The user came with a task, not a name, so a handle with no match is a reason
 * to look wider rather than to stop.
 *
 * One request PER KEYWORD, merged here. The registry matches `q` as a literal
 * substring, so joining the keywords into one string asked it for a phrase no
 * skill contains: every multi-keyword search returned nothing, which is every
 * search the router issues (its instructions say to compose up to three
 * keywords). `skillet search` has always fanned out this way; this path did not,
 * and the divergence made the whole library fall-through silently empty.
 *
 * Ranking mirrors `skillet search`: match breadth first, since a ref that
 * answers two of three keywords beats one that answers a single keyword well,
 * then the registry's relevance tier, then installs.
 */
export async function searchPublicSkills(keywords: string[]): Promise<SummonCandidate[]> {
  const queries = Array.from(
    new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)),
  ).slice(0, 3);
  if (queries.length === 0) return [];

  const perQuery = await Promise.all(
    queries.map(async (q) => {
      const url = `${base()}${REGISTRY_API}/search?q=${encodeURIComponent(q)}&types=skills`;
      try {
        const res = await fetch(url, {
          headers: {
            accept: "application/json",
            // Attributes the query to the router's fallback. Carries nothing
            // about the user or the task; the query text itself is never stored.
            "x-skillet-search-source": "summon-fallback",
          },
        });
        if (!res.ok) return [] as SearchHit[];
        return readSearchHits(await res.json());
      } catch {
        return [] as SearchHit[];
      }
    }),
  );

  const merged = new Map<string, SearchHit>();
  for (const hits of perQuery) {
    for (const hit of hits) {
      const seen = merged.get(hit.ref);
      if (!seen) {
        merged.set(hit.ref, { ...hit });
        continue;
      }
      seen.matches += 1;
      if (hit.score > seen.score) seen.score = hit.score;
      if (!seen.description && hit.description) seen.description = hit.description;
    }
  }

  // The floor is the difference between "no skill for this" and confidently
  // handing over a skill that shares one word with the task. A miss the router
  // admits to beats a wrong skill it applies.
  const ranked = [...merged.values()]
    .filter((h) => h.score >= RELEVANCE_FLOOR)
    .sort((a, b) => b.matches - a.matches || b.score - a.score || b.installs - a.installs)
    .slice(0, MAX_CANDIDATES);

  const withHashes = await Promise.all(
    ranked.map(async (h): Promise<SummonCandidate | null> => {
      const latestHash = await latestHashFor(h.ref);
      // No pinned version means no loadable candidate, however good it looks.
      if (!latestHash) return null;
      return { ref: h.ref, description: h.description, latestHash, via: null };
    }),
  );
  return withHashes.filter((c): c is SummonCandidate => c !== null);
}

/**
 * Load a summoned skill's body, crediting the author.
 *
 * The marker is metadata only: which skill, and which handle surfaced it.
 * Never the task text.
 */
export async function fetchSummonBody(
  ref: string,
  hash: string,
  opts: { via?: string | null; runtime?: string | null } = {},
): Promise<string | null> {
  const m = /^@?([^/@\s]+)\/([^/\s]+)$/.exec(ref.trim());
  if (!m) return null;
  const path = `/skills/${encodeURIComponent(m[1]!)}/${encodeURIComponent(m[2]!)}/versions/${encodeURIComponent(hash)}`;

  let url = `${base()}${REGISTRY_API}${path}`;
  if (marksActivity()) {
    const q = new URLSearchParams({ src: "summon" });
    if (opts.via) q.set("via", bareHandle(opts.via));
    if (opts.runtime) q.set("runtime", opts.runtime);
    url += `?${q.toString()}`;
  }

  const res = await getJson(url);
  if (!res.ok) return null;
  const files = (res.body as { files?: Record<string, { data?: unknown }> })?.files;
  const data = files?.["SKILL.md"]?.data;
  return typeof data === "string" ? data : null;
}
