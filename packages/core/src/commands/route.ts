import { access } from "node:fs/promises";
import { readState, skillContentPath } from "../kit/store.js";
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
  return entry.slug === BUNDLED_ROUTE_SLUG || skillRefFromEntry(entry) === BUNDLED_ROUTE_SLUG;
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

export async function listRouteManifest(): Promise<RouteManifestEntry[]> {
  const state = await readState();
  const skills = Object.values(state.skills).filter((entry) => !isBundledRouteEntry(entry));

  const out: RouteManifestEntry[] = [];
  for (const entry of skills) {
    const path = skillContentPath(entry.slug);
    try {
      await access(path);
    } catch {
      continue;
    }
    out.push({
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      owner: entry.owner ?? null,
      skillRef: skillRefFromEntry(entry),
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
