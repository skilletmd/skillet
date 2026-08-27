import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { readState, skillContentPath, SKILLET_DIR } from "../kit/store.js";
import { resolveSkillDescription } from "../kit/skill-description.js";
import { fetchSummonBody } from "./summon.js";
import type { SkillEntry } from "../kit/types.js";
import { detectInitiator, recordEvent } from "../metrics.js";
import {
  recordLocalRoute,
  readRouteHistory,
  rankSkillRefs,
  sanitizeMetaValue,
} from "../kit/route-history.js";
import type { KitState } from "../kit/types.js";

export const BUNDLED_ROUTE_SLUG = "@skillet/route";
/** On-disk dir name for `@skillet/route` so Cursor exposes `/skillet`, not `/skillet--route`. */
export const BUNDLED_ROUTE_MATERIALIZE_DIR = "skillet";

/** The `/skillet create` playbook, bundled alongside the router. */
export const BUNDLED_CREATE_SLUG = "@skillet/create";
/** On-disk dir name for `@skillet/create` so agents expose `/skillet-create`. */
export const BUNDLED_CREATE_MATERIALIZE_DIR = "skillet-create";

/** Every meta-skill the CLI ships itself. Excluded from routing candidates. */
export const BUNDLED_META_SLUGS = [BUNDLED_ROUTE_SLUG, BUNDLED_CREATE_SLUG] as const;

export interface RouteManifestEntry {
  slug: string;
  name: string;
  description: string;
  owner: string | null;
  skillRef: string;
  path: string;
}

export type RouteSkillErrorCode = "kit_empty" | "skill_not_in_kit";

/**
 * Where a /skillet invocation fired — the "invocation surface" axis of route
 * telemetry. Distinct from `runtime` (which agent, e.g. "cursor") and `source`
 * (which recorder, e.g. "cursor-hook"). Add new recorders here.
 */
export const KNOWN_ROUTE_SURFACES = [
  'user-prompt-submit', // Claude Code / Codex prompt-submit hook
  'before-submit-prompt', // Cursor hook
  'skill-instructions', // the bundled @skillet/route skill following its own instructions
  'route-verb', // a route verb recording for itself (the stub calls one verb, not three)
] as const;
export type RouteSurface = (typeof KNOWN_ROUTE_SURFACES)[number];

export interface RouteInvocationOptions {
  runtime?: string;
  source?: string;
  /** Known values in {@link RouteSurface}; anything else is sanitized to a slug. */
  surface?: string;
}

export class RouteSkillError extends Error {
  readonly code: RouteSkillErrorCode;

  constructor(code: RouteSkillErrorCode, message: string) {
    super(message);
    this.name = "RouteSkillError";
    this.code = code;
  }
}

export function skillRefFromEntry(entry: SkillEntry): string {
  if (entry.slug.startsWith("@")) return entry.slug;
  if (entry.owner) return `@${entry.owner}/${entry.slug}`;
  return entry.slug;
}

function isBundledRouteEntry(entry: SkillEntry): boolean {
  const ref = skillRefFromEntry(entry);
  return BUNDLED_META_SLUGS.some((slug) => entry.slug === slug || ref === slug);
}

export function findSkillEntryByRef(ref: string, state: KitState): SkillEntry | null {
  const normalized = ref.trim();
  if (!normalized) return null;
  if (state.skills[normalized]) return state.skills[normalized];
  for (const entry of Object.values(state.skills)) {
    if (skillRefFromEntry(entry) === normalized) return entry;
  }
  return null;
}

function isBundledMetaSlug(slug: string): boolean {
  return BUNDLED_META_SLUGS.some((meta) => meta === slug);
}

/**
 * Every skill slug present in the store, whether or not kit state tracks it.
 *
 * Routing candidacy is decided by what's readable on disk, not by what state
 * happens to carry. A skill the user authored is materialized into the store
 * without ever getting a state entry, so a state-only manifest is blind to the
 * author's own work — `/skillet` would whiff to the library while the matching
 * skill sat on disk. Fail-silent: an unreadable store yields no disk slugs and
 * the manifest degrades to today's state-only behavior rather than breaking.
 */
async function listStoreSlugs(): Promise<string[]> {
  const root = join(SKILLET_DIR, "skills");
  const slugs: string[] = [];
  let top: Dirent[];
  try {
    top = await readdir(root, { withFileTypes: true });
  } catch {
    return slugs;
  }
  for (const entry of top) {
    if (!entry.isDirectory()) continue;
    // `@owner` is a namespace dir, never a skill itself; anything else is a
    // bare-slug skill (an import or a local skill with no owner).
    if (!entry.name.startsWith("@")) {
      slugs.push(entry.name);
      continue;
    }
    try {
      for (const child of await readdir(join(root, entry.name), { withFileTypes: true })) {
        if (child.isDirectory()) slugs.push(`${entry.name}/${child.name}`);
      }
    } catch {
      // Unreadable namespace dir: skip it, keep the rest of the store.
    }
  }
  return slugs;
}

/** Name + description for a store skill kit state doesn't describe. */
async function describeStoreSkill(
  slug: string,
  path: string,
): Promise<{ name: string; description: string }> {
  const bare = slug.startsWith("@") ? (slug.split("/")[1] ?? slug) : slug;
  try {
    const parsed = matter(await readFile(path, "utf8"));
    const fm = parsed.data as Record<string, unknown>;
    const name = typeof fm.name === "string" && fm.name.trim() ? fm.name.trim() : bare;
    const { description } = resolveSkillDescription({
      frontmatterDescription: typeof fm.description === "string" ? fm.description : undefined,
      body: parsed.content,
      slug: name,
    });
    return { name, description };
  } catch {
    return { name: bare, description: bare };
  }
}

/**
 * Cap on a verb's whole serialized response, not on the skill body alone.
 *
 * Every verb returns data PLUS its instruction block, so what a host truncates
 * is body + block + envelope. Hosts persist an oversized tool result to a file
 * and hand the model a short preview, which is worse than useless here: the
 * agent would act on a partial skill without knowing it. The verb cannot see
 * the caller's limit, so it uses a conservative constant and returns a path
 * instead. One extra read beats silently truncated instructions.
 */
export const ROUTE_RESPONSE_MAX_BYTES = 24_000;

export interface RouteBody {
  ref: string;
  /** Absolute path to the skill's SKILL.md. Always present. */
  path: string;
  /** The body, or null when the response would exceed the cap — read `path`. */
  body: string | null;
}

const bareHash = (h: string): string => h.replace(/^sha256:/, "");

/**
 * Load a picked skill's body, or decline and hand back a path.
 *
 * The single owner of body loading for every path (local kit and summon alike).
 * That sole ownership is what keeps a repeat fetch structurally impossible
 * inside one invocation rather than something the server has to de-duplicate.
 */
export async function resolveRouteBody(
  ref: string,
  opts: {
    reserveBytes?: number;
    /** Present on the summon path: the candidate's version, plus attribution. */
    summon?: { hash: string; via?: string | null; runtime?: string | null };
  } = {},
): Promise<RouteBody | null> {
  const state = await readState();
  const entry = findSkillEntryByRef(ref, state);
  // A store skill with no state entry is routable (see listRouteManifest), so
  // fall back to the ref as a slug rather than reporting it missing.
  const slug = entry?.slug ?? (ref.startsWith("@") ? ref : null);
  const budget = ROUTE_RESPONSE_MAX_BYTES - (opts.reserveBytes ?? 0);
  const fit = (body: string): string | null =>
    Buffer.byteLength(body, "utf8") <= budget ? body : null;

  let localPath: string | null = null;
  if (slug) {
    try {
      localPath = skillContentPath(slug);
    } catch {
      localPath = null;
    }
  }

  if (opts.summon) {
    // Compare against materialized_hash, which records what actually reached
    // disk. `hash` advances during pull BEFORE materialize, so a version that
    // was persisted but never written would report a match and we would serve
    // stale bytes as the author's current skill.
    const onDisk = entry?.materialized_hash;
    if (localPath && onDisk && bareHash(onDisk) === bareHash(opts.summon.hash)) {
      try {
        const body = await readFile(localPath, "utf8");
        // Credit the author even though nothing was fetched. Attribution is a
        // product commitment; it cannot depend on whether a cache hit occurred.
        void fetchSummonMarker(ref, opts.summon).catch(() => {});
        return { ref, path: localPath, body: fit(body) };
      } catch {
        // Fall through and fetch.
      }
    }

    const fetched = await fetchSummonBody(ref, opts.summon.hash, {
      via: opts.summon.via ?? null,
      runtime: opts.summon.runtime ?? null,
    });
    if (fetched == null) return null;
    const inline = fit(fetched);
    if (inline != null) return { ref, path: localPath ?? "", body: inline };
    // Too large to inline and no on-disk source: park it so the agent has a
    // path to read rather than a truncated body.
    const parked = await parkSummonBody(ref, fetched);
    return parked ? { ref, path: parked, body: null } : null;
  }

  if (!localPath) return null;
  try {
    const body = await readFile(localPath, "utf8");
    return { ref, path: localPath, body: fit(body) };
  } catch {
    return null;
  }
}

/** Fire the summon marker without pulling the body, for a local-read summon. */
async function fetchSummonMarker(
  ref: string,
  summon: { hash: string; via?: string | null; runtime?: string | null },
): Promise<void> {
  await fetchSummonBody(ref, summon.hash, {
    via: summon.via ?? null,
    runtime: summon.runtime ?? null,
  });
}

/** Write an oversized summoned body under the skillet dir and return its path. */
async function parkSummonBody(ref: string, body: string): Promise<string | null> {
  try {
    const dir = join(SKILLET_DIR, "summoned");
    await mkdir(dir, { recursive: true });
    const safe = ref.replace(/^@/, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
    const path = join(dir, `${safe}.SKILL.md`);
    await writeFile(path, body, "utf8");
    return path;
  } catch {
    return null;
  }
}

export async function listRouteManifest(): Promise<RouteManifestEntry[]> {
  const state = await readState();
  const skills = Object.values(state.skills).filter((entry) => !isBundledRouteEntry(entry));

  const out: RouteManifestEntry[] = [];
  const seen = new Set<string>();
  for (const entry of skills) {
    const path = skillContentPath(entry.slug);
    try {
      await access(path);
    } catch {
      continue;
    }
    seen.add(entry.slug);
    out.push({
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      owner: entry.owner ?? null,
      skillRef: skillRefFromEntry(entry),
      path,
    });
  }

  // Union in store skills state never recorded (authored skills, chiefly).
  // State metadata wins where both exist, so this only ever adds candidates.
  for (const slug of await listStoreSlugs()) {
    if (seen.has(slug) || isBundledMetaSlug(slug)) continue;
    let path: string;
    try {
      path = skillContentPath(slug);
      await access(path);
    } catch {
      continue;
    }
    seen.add(slug);
    const owner = slug.startsWith("@") ? (slug.slice(1).split("/")[0] ?? null) : null;
    out.push({
      ...(await describeStoreSkill(slug, path)),
      slug,
      owner,
      skillRef: slug,
      path,
    });
  }

  // Usage-ranked order: the agent picks from the user's own most-used skills
  // first — invocation count, then most-recent, then alphabetical. A cold/
  // anonymous user with no history collapses to skillRef-ascending, i.e. exactly
  // today's alphabetical output. Fail-silent: any history read error falls back
  // to the stable alphabetical order rather than breaking routing.
  try {
    const history = await readRouteHistory();
    // Group by skillRef so two kit entries that resolve to the same ref both
    // survive (rankSkillRefs works on the unique ref set); single rank sort.
    const groups = new Map<string, RouteManifestEntry[]>();
    for (const e of out) {
      const g = groups.get(e.skillRef);
      if (g) g.push(e);
      else groups.set(e.skillRef, [e]);
    }
    return rankSkillRefs([...groups.keys()], history).flatMap((ref) => groups.get(ref)!);
  } catch {
    return out.sort((a, b) => a.skillRef.localeCompare(b.skillRef));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WHAT LEAVES THE MACHINE for a /skillet route (the complete list — nothing else)
//
// A route emits at most two events, uploaded only when the user has opted into
// recording (see metrics.ts flushEvents + routeConsentChosen). Their fields:
//
//   skill.route.invoke  — one per /skillet invocation:
//       command  always "skillet"
//       runtime  which agent (e.g. "cursor")            } each passed through
//       source   which recorder fired it (e.g. "cursor-hook") } sanitizeMetaValue,
//       surface  where it fired (e.g. "user-prompt-submit")   } so it can only be
//                                                               a short a-z0-9._- slug
//   skill.route         — one per routed pick:
//       skill_ref  the kit-canonical skill ref (e.g. "@thiago/the-lazy-dm")
//
// Plus, on every event (recordEvent): the event name, an ISO timestamp, and an
// initiator tag (human | daemon | ci). No task, prompt, agent reasoning, or any
// free-text field is ever attached — sanitizeMetaValue guarantees it.
// ─────────────────────────────────────────────────────────────────────────────

export function recordRouteInvocation(
  opts: RouteInvocationOptions = {},
): { event: "skill.route.invoke"; meta: Record<string, string> } {
  const meta: Record<string, string> = { command: "skillet" };
  const runtime = sanitizeMetaValue(opts.runtime);
  const source = sanitizeMetaValue(opts.source);
  const surface = sanitizeMetaValue(opts.surface);
  if (runtime) meta.runtime = runtime;
  if (source) meta.source = source;
  if (surface) meta.surface = surface;

  recordEvent("skill.route.invoke", detectInitiator(), meta);
  return { event: "skill.route.invoke", meta };
}

export interface RecordSkillRouteOptions {
  runtime?: string;
}

export async function recordSkillRoute(
  skillRef: string,
  opts: RecordSkillRouteOptions = {},
): Promise<{ skillRef: string; slug: string }> {
  const state = await readState();
  if (Object.keys(state.skills).length === 0) {
    throw new RouteSkillError(
      "kit_empty",
      "No skills in your kit. Run `skillet sync` or `skillet add @author/skill` first.",
    );
  }

  const entry = findSkillEntryByRef(skillRef, state);
  if (!entry || isBundledRouteEntry(entry)) {
    throw new RouteSkillError(
      "skill_not_in_kit",
      `Skill not in kit: ${skillRef.trim()}`,
    );
  }

  try {
    await access(skillContentPath(entry.slug));
  } catch {
    throw new RouteSkillError(
      "skill_not_in_kit",
      `Skill not in kit: ${skillRefFromEntry(entry)}`,
    );
  }

  const canonicalRef = skillRefFromEntry(entry);

  // Upload the pick only for registry-sourced skills. A registry skill's ref is
  // already public; a local/private skill's ref is user-authored and could be
  // sensitive (e.g. `client-acme-layoffs`), so it must never leave the machine.
  // The uploaded record is the skill ref only — never the agent's rationale.
  // Fail safe to privacy: anything not explicitly `registry` (incl. legacy
  // entries with no source) is treated as local and not uploaded.
  if (entry.source === "registry") {
    recordEvent("skill.route", detectInitiator(), { skill_ref: canonicalRef });
  }

  // Local route-history write: unconditional (every route, local or registry) and
  // independent of the upload opt-in, so your own `skillet usage` dashboard is
  // complete while local-skill refs never upload. Fail-silent — never breaks a route.
  await recordLocalRoute({ skillRef: canonicalRef, runtime: opts.runtime });

  return { skillRef: canonicalRef, slug: entry.slug };
}
