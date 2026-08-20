// Local route-history store (content-free, local-only). Every `/skillet` route
// writes one row here regardless of account state or the upload opt-in, so
// usage-ranked routing and the `skillet usage` dashboard work offline and for
// anonymous users while uploading nothing.
//
// Privacy invariant: the store holds ONLY skill-scoped, non-content fields.
// Caller-supplied metadata (runtime) is charset+length sanitized here; the skill
// ref is a kit-derived canonical ref and the timestamp is generated, so both are
// trusted by construction rather than sanitized.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { skilletDir } from "../session-token.js";
import { atomicWrite } from "../util/atomic.js";

/** A skill not routed within this window is a prune candidate. */
export const USAGE_DEADWEIGHT_DAYS = 30;

const ROUTE_HISTORY_VERSION = 1;

/** Max length of any recorded metadata value (runtime, source, surface, …). */
export const ROUTE_META_MAX = 64;

/** Per-skill aggregate. */
export interface SkillUsage {
  count: number;
  firstUsed: string;
  lastUsed: string;
  runtimes: Record<string, number>;
}

export interface RouteHistory {
  version: number;
  skills: Record<string, SkillUsage>;
}

/** Input to a single local-route write. Only these fields are persisted. */
export interface LocalRouteInput {
  skillRef: string;
  runtime?: string;
  /** ISO timestamp; defaults to now. */
  ts?: string;
}

/** One derived usage row for the dashboard/ranking. */
export interface SkillUsageView {
  skillRef: string;
  count: number;
  firstUsed: string;
  lastUsed: string;
  runtimes: Record<string, number>;
  /** True when lastUsed is older than USAGE_DEADWEIGHT_DAYS. */
  deadWeight: boolean;
}

function routeHistoryPath(): string {
  return join(skilletDir(), "route-history.json");
}

function emptyHistory(): RouteHistory {
  return { version: ROUTE_HISTORY_VERSION, skills: {} };
}

/**
 * THE content firewall for all recorded route metadata. Every metadata value
 * that Skillet stores or uploads (runtime, source, surface) passes through here
 * first, so no free text can ever be smuggled into a route record: the value is
 * lowercased, everything outside `[a-z0-9._-]` becomes `-`, and it is capped at
 * ROUTE_META_MAX chars. A task, prompt, or sentence cannot survive this — it
 * comes out as a short slug. This is the single function that makes the
 * "never records your task/prompt/reasoning" guarantee true; keep it that way.
 */
export function sanitizeMetaValue(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return undefined;
  const safe = trimmed.replace(/[^a-z0-9._-]/g, "-").slice(0, ROUTE_META_MAX);
  return safe || undefined;
}

/** True when a skill's last route is older than `days`. */
function isStale(lastUsed: string, days: number): boolean {
  const age = Date.now() - Date.parse(lastUsed);
  return Number.isFinite(age) && age > days * 24 * 60 * 60 * 1000;
}

export async function readRouteHistory(): Promise<RouteHistory> {
  try {
    const parsed = JSON.parse(await readFile(routeHistoryPath(), "utf8")) as Partial<RouteHistory>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.skills !== "object") {
      return emptyHistory();
    }
    // Read only the fields we use; any extra keys (from a newer writer) are
    // ignored, so the store is forward-compatible without a migration.
    return {
      version: parsed.version ?? ROUTE_HISTORY_VERSION,
      skills: (parsed.skills as Record<string, SkillUsage>) ?? {},
    };
  } catch {
    // Missing or corrupt file — never throw; ranking/dashboard degrade gracefully.
    return emptyHistory();
  }
}

async function writeRouteHistory(history: RouteHistory): Promise<void> {
  try {
    // Soft analytics cache: keep the atomic rename (no corrupt partial JSON) but
    // skip the per-write fsync — this runs on every route and the data is
    // best-effort, not a durability-critical record.
    await atomicWrite(routeHistoryPath(), JSON.stringify(history, null, 2) + "\n", {
      backup: false,
      fsync: false,
    });
  } catch {
    // fail-silent — the local store must never break or slow a route.
  }
}

/**
 * Record one route locally. Content-free and fail-silent — never throws and
 * never blocks the route.
 */
export async function recordLocalRoute(input: LocalRouteInput): Promise<void> {
  const skillRef = input.skillRef?.trim();
  if (!skillRef) return;
  const ts = input.ts ?? new Date().toISOString();
  const runtime = sanitizeMetaValue(input.runtime);

  // The read and write are individually fail-silent, but the mutation between
  // them must not throw either — a hand-edited/foreign row could omit `runtimes`.
  // Coerce the reused entry to a well-formed shape and guard the whole body so a
  // route is never broken by a malformed store.
  try {
    const history = await readRouteHistory();
    const prior = history.skills[skillRef];
    const skill: SkillUsage = {
      count: (prior?.count ?? 0) + 1,
      firstUsed: prior?.firstUsed ?? ts,
      lastUsed: ts,
      runtimes: prior?.runtimes ?? {},
    };
    if (runtime) skill.runtimes[runtime] = (skill.runtimes[runtime] ?? 0) + 1;
    history.skills[skillRef] = skill;
    await writeRouteHistory(history);
  } catch {
    // Never break or slow a route on a bad local store.
  }
}

/** Derive a display row for one skill (dead-weight flag). */
function toView(skillRef: string, u: SkillUsage): SkillUsageView {
  return {
    skillRef,
    count: u.count,
    firstUsed: u.firstUsed,
    lastUsed: u.lastUsed,
    runtimes: u.runtimes,
    deadWeight: isStale(u.lastUsed, USAGE_DEADWEIGHT_DAYS),
  };
}

/**
 * Order the given manifest refs by the user's own usage: invocation count desc
 * → last-used desc → skillRef asc. Refs absent from history collapse
 * to skillRef-ascending after ranked ones, so a cold/anonymous user gets the
 * same deterministic alphabetical order as before.
 */
export function rankSkillRefs(manifestRefs: string[], history: RouteHistory): string[] {
  return [...manifestRefs].sort((a, b) => {
    const ua = history.skills[a];
    const ub = history.skills[b];
    const ca = ua?.count ?? 0;
    const cb = ub?.count ?? 0;
    if (cb !== ca) return cb - ca;
    const la = ua ? Date.parse(ua.lastUsed) : 0;
    const lb = ub ? Date.parse(ub.lastUsed) : 0;
    if ((lb || 0) !== (la || 0)) return (lb || 0) - (la || 0);
    return a.localeCompare(b);
  });
}

/** All usage rows as display views, most-used first (for `skillet usage`). */
export function usageViews(history: RouteHistory): SkillUsageView[] {
  return Object.entries(history.skills)
    .map(([ref, u]) => toView(ref, u))
    .sort((a, b) => b.count - a.count || a.skillRef.localeCompare(b.skillRef));
}

/** Serialize the recorded data for export. */
export function exportRecord(history: RouteHistory): { version: number; skills: Record<string, SkillUsage> } {
  return { version: history.version, skills: history.skills };
}

/** Delete the local route history (delete path). Fail-silent. */
export async function clearRouteHistory(): Promise<void> {
  await writeRouteHistory(emptyHistory());
}
