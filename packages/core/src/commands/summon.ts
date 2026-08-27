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

/**
 * Cross-author search, for when the named handle has nothing that fits.
 *
 * The user came with a task, not a name, so a handle with no match is a reason
 * to look wider rather than to stop.
 */
export async function searchPublicSkills(keywords: string[]): Promise<SummonCandidate[]> {
  const q = keywords.map((k) => k.trim()).filter(Boolean).slice(0, 3).join(" ");
  if (!q) return [];
  const url = `${base()}${REGISTRY_API}/search?q=${encodeURIComponent(q)}&types=skills`;
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        // Attributes the query to the router's fallback. Carries nothing about
        // the user or the task; the query text itself is never stored.
        "x-skillet-search-source": "summon-fallback",
      },
    });
    if (!res.ok) return [];
    return readCandidates(await res.json());
  } catch {
    return [];
  }
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
