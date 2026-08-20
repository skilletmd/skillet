// Activity sink (Phase 0). The actions taken across the CLI (sync, add, publish,
// login…) post to the registry's activity stream so retention/cohorts/cross-
// vendor distribution (availability) can be computed later — history is irrecoverable, so it accrues
// now. It's the record of your sync, not separate telemetry, and it powers your
// devices and profile.
//
// Privacy: recorded by default for account-bound clients, disclosed on first
// sync. Opt out with `activity: false` in ~/.skillet/config.json (or
// SKILLET_ACTIVITY=0); the genuine "don't record me" path is anonymous local-
// first use (no account). The payload is metadata only, and failures are
// swallowed: activity reporting must never break or slow a command.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { skilletDir } from './session-token.js';
import { loadRegistryBearer } from './auth-token.js';
import { REGISTRY_API } from './registry-api.js';
import { REGISTRY_URL_DEFAULT } from './kit/types.js';

export type Initiator = 'human' | 'daemon' | 'ci';

export interface SkilletEvent {
  name: string;
  initiator: Initiator;
  ts: string;
  meta?: Record<string, string | number | boolean>;
}

let queue: SkilletEvent[] = [];
let scheduled = false;
let recordCache: boolean | null = null;

/** Default ON for account-bound clients; opt out via env or config `activity:false`. */
async function activityRecording(): Promise<boolean> {
  const env = process.env['SKILLET_ACTIVITY'];
  if (env === '0' || env === 'false') return false;
  if (env === '1' || env === 'true') return true;
  if (recordCache != null) return recordCache;
  try {
    const raw = await readFile(join(skilletDir(), 'config.json'), 'utf8');
    recordCache = (JSON.parse(raw) as { activity?: boolean }).activity !== false;
  } catch {
    recordCache = true; // default ON — disclosed on first sync; anonymous mode is the opt-out
  }
  return recordCache;
}

/**
 * Record one human/daemon/ci-tagged event. Buffers and best-effort flushes; the
 * north-star (human-only) filtering happens at query time on the `initiator` tag.
 */
export function recordEvent(
  name: string,
  initiator: Initiator,
  meta?: Record<string, string | number | boolean>,
): void {
  queue.push({ name, initiator, ts: new Date().toISOString(), ...(meta ? { meta } : {}) });
  if (process.env['SKILLET_ACTIVITY_DEBUG'] === '1') {
    process.stderr.write(`[skillet:metric] ${JSON.stringify(queue[queue.length - 1])}\n`);
  }
  if (!scheduled) {
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      void flushEvents();
    }, 0);
  }
}

/**
 * Flush the buffered events to the registry. Safe to await from the CLI exit path
 * to avoid losing the last batch; otherwise it best-effort flushes on a timer.
 */
export async function flushEvents(): Promise<void> {
  if (queue.length === 0) return;
  if (!(await activityRecording())) {
    queue = [];
    return;
  }
  let batch = queue;
  queue = [];
  // Route-scoped events (`skill.route*`) require an explicit first-run consent
  // choice before they upload. Until `routeConsentChosen` is true, drop them from
  // the batch so the legacy absent-`activity` default-on can never silently opt a
  // deferred/CI user into route uploads. Non-route events keep prior behavior.
  if (!(await routeConsentChosen())) {
    batch = batch.filter((e) => !e.name.startsWith('skill.route'));
  }
  if (batch.length === 0) return;
  try {
    const { token } = await loadRegistryBearer();
    if (!token) return; // unattributed events aren't useful — skip
    const base = (process.env['SKILLET_REGISTRY_URL'] ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
    await fetch(`${base}${REGISTRY_API}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ events: batch }),
    });
  } catch {
    // fail-silent — telemetry must never break or slow a command.
  }
}

/**
 * Report cross-vendor distribution (availability): which of your skills are
 * present in which runtimes on this machine. Current-state upsert, opt-out aware,
 * metadata only (refs + runtime names). Fail-silent and best-effort like the
 * event sink. Sent on sync alongside the lean `sync` event (which never carries
 * the skill list).
 */
export async function reportAvailability(skillRefs: string[], runtimes: string[]): Promise<void> {
  if (skillRefs.length === 0 || runtimes.length === 0) return;
  if (!(await activityRecording())) return;
  try {
    const { token } = await loadRegistryBearer();
    if (!token) return;
    const base = (process.env['SKILLET_REGISTRY_URL'] ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
    await fetch(`${base}${REGISTRY_API}/sync/availability`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ skill_refs: skillRefs, runtimes }),
    });
  } catch {
    // fail-silent — availability reporting must never break or slow a sync.
  }
}

/**
 * Disclose default-on activity recording — but only where no consent surface
 * will ask. An interactive run asks the real question instead (the CLI's
 * skill-stats consent, right after sync), and once the choice is made there
 * is nothing left to disclose. What remains is the headless default-on case:
 * one line, once, and record that it's been shown.
 */
export async function maybeDiscloseActivity(): Promise<void> {
  if (!(await activityRecording())) return;
  if (await routeConsentChosen()) return;
  if (process.stdout.isTTY === true) return;
  const path = join(skilletDir(), 'config.json');
  let cfg: Record<string, unknown> = {};
  try {
    cfg = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    /* no config yet */
  }
  if (cfg['activityDisclosed'] === true) return;
  process.stderr.write(
    'Skillet records sync stats (which skills, which agents) to your account. Set SKILLET_ACTIVITY=0 to keep them local.\n',
  );
  cfg['activityDisclosed'] = true;
  try {
    await mkdir(skilletDir(), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(cfg, null, 2));
  } catch {
    /* best-effort; if we can't persist the flag we'll just disclose again */
  }
}

export interface ActivityState {
  /** Whether activity is currently being recorded. */
  recording: boolean;
  /** What decides it: an env override, the config file, or the default-on. */
  source: 'env' | 'config' | 'default';
  /** Whether the first-sync disclosure has been shown. */
  disclosed: boolean;
  /** Whether the one-time /skillet route-consent choice has been made. */
  routeConsentChosen: boolean;
}

/** The effective activity state, for `skillet activity status`. */
export async function activityState(): Promise<ActivityState> {
  const env = process.env['SKILLET_ACTIVITY'];
  const cfg = await readConfig();
  const disclosed = cfg['activityDisclosed'] === true;
  const configured = cfg['activity'] as boolean | undefined;
  const base = { disclosed, routeConsentChosen: cfg['routeConsentChosen'] === true };
  if (env === '0' || env === 'false') return { recording: false, source: 'env', ...base };
  if (env === '1' || env === 'true') return { recording: true, source: 'env', ...base };
  if (configured === false) return { recording: false, source: 'config', ...base };
  if (configured === true) return { recording: true, source: 'config', ...base };
  return { recording: true, source: 'default', ...base };
}

/** Persist the local activity opt-in/out (`skillet activity on|off`). */
export async function setActivity(on: boolean): Promise<void> {
  await mergeConfig({ activity: on });
  recordCache = on; // refresh the in-process cache
}

/** Parse config.json into a plain object, or {} when absent/unreadable. */
async function readConfig(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(join(skilletDir(), 'config.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}

/** Read+merge a patch into config.json (mode 0o700 dir), preserving other keys. */
async function mergeConfig(patch: Record<string, unknown>): Promise<void> {
  const cfg = await readConfig();
  Object.assign(cfg, patch);
  await mkdir(skilletDir(), { recursive: true, mode: 0o700 });
  await writeFile(join(skilletDir(), 'config.json'), JSON.stringify(cfg, null, 2));
}

/**
 * Whether the one-time `/skillet` route-consent choice has been made. Until it
 * has, route-scoped events do not upload (see flushEvents) — this is the
 * tri-state gate that keeps a deferred/CI user from being silently opted in by
 * the legacy absent-`activity` default-on. Absent means "not chosen".
 */
export async function routeConsentChosen(): Promise<boolean> {
  return (await readConfig())['routeConsentChosen'] === true;
}

/**
 * Persist the first-run route-consent choice. `record` sets the operational
 * activity flag on; staying local sets it off — either way the choice is marked
 * made so route events may upload when recording is on.
 */
export async function chooseRouteConsent(record: boolean): Promise<void> {
  await setActivity(record);
  await mergeConfig({ routeConsentChosen: true });
}

export function detectInitiator(): Initiator {
  if (process.env['CI'] || process.env['SKILLET_TOKEN']) return 'ci';
  if (process.env['SKILLET_DAEMON'] === '1') return 'daemon';
  return 'human';
}
