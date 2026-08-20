import { RegistryClient } from '../registry/client.js';
import { readDeviceFile } from '../device-token.js';
import { readEditedReported, setEditedReported } from '../kit/store.js';
import type { RegistryBearerKind } from '../auth-token.js';
import type { SkillEntry } from '../kit/types.js';

export interface ReportDeviceAgentsOptions {
  registryUrl: string;
  token: string;
  bearerKind: RegistryBearerKind;
  agents: string[];
  fetchImpl?: typeof fetch;
}

/**
 * After sync, report detected runtimes for this machine's connected device row.
 * Skips kit-keys and machines without a linked device_id (session-only with no pair).
 */
export async function reportDeviceAgents(opts: ReportDeviceAgentsOptions): Promise<void> {
  if (opts.bearerKind === 'kit' || opts.bearerKind === 'none' || !opts.token) return;
  if (opts.agents.length === 0) return;

  const meta = await readDeviceFile();
  const deviceId = meta?.device_id;
  if (!deviceId) return;

  const client = new RegistryClient({
    baseUrl: opts.registryUrl,
    token: opts.token,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  await client.reportDeviceAgents(deviceId, opts.agents);
}

/** Best-effort — sync must not fail when the registry is unreachable. */
export function pingDeviceAgents(opts: ReportDeviceAgentsOptions): void {
  void reportDeviceAgents(opts).catch(() => undefined);
}

export type MaterializationStatus = 'materialized' | 'skipped-not-detected' | 'failed';

export interface SkillRuntimeMaterialization {
  skill_slug: string;
  runtime: string;
  status: MaterializationStatus;
}

/** The subset of a SyncResult needed to derive per-skill/per-runtime status. */
export interface MaterializationSource {
  materialized: Array<{ slug: string; dest: string }>;
  adapters: Array<{ name: string; status: MaterializationStatus; paths: string[] }>;
  failed: Array<{ slug: string }>;
}

/**
 * Map a sync result to a COMPLETE per-skill × per-detected-runtime status matrix
 * the web can animate honestly. For every skill touched this sync and every
 * detected runtime (one the agent is installed in), emit the true outcome:
 *   - `materialized` — the skill's files were written into that runtime;
 *   - `failed` — the runtime is installed but the write failed (adapter threw,
 *     or the skill failed integrity verification);
 *   - `skipped-not-detected` — the runtime is installed but this skill wasn't
 *     routed there.
 * Runtimes the agent isn't installed in produce no rows (the web shows only the
 * device's detected runtimes). Completeness matters: a skill that lands nowhere
 * still reports a row per runtime, so the reveal never spins, and a write that
 * failed on an installed runtime is shown as failed, never as "not installed".
 */
export function deriveMaterializations(src: MaterializationSource): SkillRuntimeMaterialization[] {
  const destToSlug = new Map(src.materialized.map((m) => [m.dest, m.slug]));
  const failedSlugs = new Set(src.failed.map((f) => f.slug));
  // Skills a reveal might be watching: anything written or integrity-failed.
  const touched = new Set<string>([...src.materialized.map((m) => m.slug), ...failedSlugs]);
  // Detected runtimes = adapters the agent is installed in (anything not
  // skipped-not-detected), including ones that failed mid-materialize.
  const detected = src.adapters.filter((a) => a.status !== 'skipped-not-detected');
  // For each materialized adapter, the slugs it actually wrote.
  const writtenByAdapter = new Map<string, Set<string>>();
  for (const a of src.adapters) {
    if (a.status !== 'materialized') continue;
    const written = new Set<string>();
    for (const p of a.paths) {
      const slug = destToSlug.get(p);
      if (slug) written.add(slug);
    }
    writtenByAdapter.set(a.name, written);
  }

  const out: SkillRuntimeMaterialization[] = [];
  for (const slug of touched) {
    for (const a of detected) {
      let status: MaterializationStatus;
      if (a.status === 'failed') {
        status = 'failed';
      } else if (writtenByAdapter.get(a.name)?.has(slug)) {
        status = 'materialized';
      } else if (failedSlugs.has(slug)) {
        status = 'failed';
      } else {
        status = 'skipped-not-detected';
      }
      out.push({ skill_slug: slug, runtime: a.name, status });
    }
  }
  return capMaterializations(out);
}

/**
 * The registry caps a materialization report at 256 rows; older registries
 * REJECT anything larger with a 400 that also kills the `edited` reconcile
 * riding the same request (the large-kit edit-flag wedge). Cap client-side so
 * every deployed registry accepts the report, keeping the most informative
 * rows: failures first (actionable), then successes, then not-detected noise.
 */
export const MAX_REPORT_MATERIALIZATIONS = 256;

const STATUS_PRIORITY: Record<MaterializationStatus, number> = {
  failed: 0,
  materialized: 1,
  'skipped-not-detected': 2,
};

export function capMaterializations(
  rows: SkillRuntimeMaterialization[],
): SkillRuntimeMaterialization[] {
  if (rows.length <= MAX_REPORT_MATERIALIZATIONS) return rows;
  return [...rows]
    .sort(
      (a, b) =>
        STATUS_PRIORITY[a.status as MaterializationStatus] -
        STATUS_PRIORITY[b.status as MaterializationStatus],
    )
    .slice(0, MAX_REPORT_MATERIALIZATIONS);
}

/**
 * A skill this device currently keeps a LOCAL edit of (KTD2). Carries only the
 * ref plus its fork lineage baseline — never filenames, counts, or content (R2).
 */
export interface EditedSkill {
  /** Canonical `@owner/slug` ref (or the bare state key when unowned). */
  ref: string;
  /** Baseline version label from the fork lineage; integer version stringified. */
  baselineVersion: string | null;
  /** Baseline content hash — the lineage identity, never the edited content. */
  baselineHash: string;
}

/**
 * The set of skills this device currently keeps a local edit of: every state
 * entry with a `customized_from` lineage. Reported alongside the post-sync
 * materialization report; the registry reconciles its edit flags to EXACTLY this
 * set (KTD2). A skill that un-customized this sync (take-theirs / restore cleared
 * `customized_from`) is simply absent, driving the registry's delete-by-absence
 * (R3). Only ref + baseline leave the machine — never content (R2).
 */
export function deriveEditedSkills(skills: Record<string, SkillEntry>): EditedSkill[] {
  const out: EditedSkill[] = [];
  for (const [slug, entry] of Object.entries(skills)) {
    const lineage = entry.customized_from;
    if (!lineage) continue;
    const ref = slug.startsWith('@')
      ? slug
      : entry.owner
        ? `@${entry.owner}/${entry.slug}`
        : slug;
    out.push({
      ref,
      baselineVersion: typeof lineage.version === 'number' ? String(lineage.version) : null,
      baselineHash: lineage.hash,
    });
  }
  return out;
}

export interface ReportDeviceMaterializationsOptions {
  registryUrl: string;
  token: string;
  bearerKind: RegistryBearerKind;
  materializations: SkillRuntimeMaterialization[];
  /** Currently-customized skills (KTD2) — ref + baseline only, reconciled by absence. */
  edited: EditedSkill[];
  fetchImpl?: typeof fetch;
}

export async function reportDeviceMaterializations(
  opts: ReportDeviceMaterializationsOptions,
): Promise<void> {
  if (opts.bearerKind === 'kit' || opts.bearerKind === 'none' || !opts.token) return;

  // The registry reconciles its per-device edit-flags to EXACTLY the edited set
  // in each report — a skill no longer present is deleted by absence (KTD2/R3).
  // So the empty edited set must still be SENT when a device un-customizes its
  // LAST edited skill, even in a sync that materializes nothing (a simultaneous
  // prune, or nothing else changed). Skipping it leaves the stale
  // `device_skill_edits` row in place, holding that skill's updates out of
  // bulk-approve indefinitely. We track whether the last report carried edits
  // (a marker in local state) and force the report on the transition FROM
  // having-reported-edits TO empty — sending `edited: []` explicitly so the
  // registry reconciles-to-empty rather than skipping.
  const hadReportedEdits = await readEditedReported();
  const clearingReport = opts.edited.length === 0 && hadReportedEdits;
  // Fire when there's anything to reconcile: a materialization matrix to record,
  // a non-empty edited set (it must ride every report where it's non-empty even
  // if nothing materialized — a held customized skill materializes nothing), OR
  // the transition-to-empty clearing case above. A device that never reported
  // edits and materializes nothing rightly stays silent (no redundant report).
  if (opts.materializations.length === 0 && opts.edited.length === 0 && !clearingReport) return;

  const meta = await readDeviceFile();
  const deviceId = meta?.device_id;
  if (!deviceId) return;

  const client = new RegistryClient({
    baseUrl: opts.registryUrl,
    token: opts.token,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  await client.reportDeviceMaterializations(deviceId, opts.materializations, opts.edited);

  // Persist the marker only AFTER a successful send so a report lost to a network
  // error retries next sync (the clearing case isn't dropped by an optimistic
  // flag flip). Set true whenever edits rode this report; clear it once the
  // now-empty set has actually reached the registry.
  if (opts.edited.length > 0) {
    if (!hadReportedEdits) await setEditedReported(true);
  } else if (hadReportedEdits) {
    await setEditedReported(false);
  }
}

/** Best-effort — sync must not fail when the registry is unreachable. */
export function pingDeviceMaterializations(opts: ReportDeviceMaterializationsOptions): void {
  void reportDeviceMaterializations(opts).catch(() => undefined);
}
