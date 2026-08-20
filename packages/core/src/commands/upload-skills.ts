/**
 * `skillet upload` — publish selected local skills to the account.
 *
 * No custom kit is created or linked: published skills reach the user's other
 * machines through the sync manifest's own-authored rows and surface on the
 * author/profile kit (/{handle}/kit). Two selection modes:
 *
 *  - `slugs` omitted → every local skill with no owner (first backup).
 *  - explicit `slugs` → resolved against both the bare key and the promoted
 *    `@handle/slug` key, then forwarded to publish even when already published,
 *    so an identical-content re-upload no-ops (private) and a visibility flip
 *    still POSTs. Unknown slugs are dropped (stale-selection safety); publish
 *    itself refuses entries authored by someone else ('not_your_skill').
 */
import { readState } from '../kit/store.js';
import { publish, PublishError } from './publish.js';
import type { ScanWireFinding, ScanBlockedBody } from '../registry/client.js';

/** A privacy/harm finding surfaced to the desktop, flattened from the registry's
 *  scan verdict (KTD2 — the registry is the single scan authority). */
export interface UploadFinding {
  file: string;
  line: number;
  category: string;
}

/** Flatten the registry's wire findings (which use lineStart/lineEnd) to the
 *  desktop-facing `{ file, line, category }` shape. */
function toUploadFindings(findings: ScanWireFinding[]): UploadFinding[] {
  return findings.map((f) => ({ file: f.file, line: f.lineStart, category: f.category }));
}

export type UploadProgressEvent =
  | { phase: 'start'; slug: string; index: number; total: number }
  | { phase: 'done'; slug: string; alreadyExists: boolean; owner: string }
  | { phase: 'fail'; slug: string; error: string };

export interface UploadLocalSkillsOptions {
  visibility?: 'private' | 'public';
  /** When omitted, every local skill with no owner in the kit store is included. */
  slugs?: string[];
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  sessionAuth?: boolean;
  onProgress?: (event: UploadProgressEvent) => void;
}

export interface UploadLocalSkillsResult {
  /** At least one skill published. */
  ok: boolean;
  /** Handle the skills published under ('' when nothing published). */
  owner: string;
  published: Array<{ slug: string; alreadyExists: boolean }>;
  /**
   * Failed uploads. `error` is the message string (kept for back-compat);
   * `findings` carries the registry's structured findings when the failure was a
   * `scan_blocked` verdict — a real secret or a confirmed-dangerous bundle the
   * registry refused (KTD2/KTD5 — additive, optional).
   */
  failed: Array<{ slug: string; error: string; findings?: UploadFinding[] }>;
  /**
   * Non-blocking findings from a *successful* upload (R3/KTD5). A skill appears
   * here when the registry `flagged` (not quarantined) the published version —
   * it published, but the patterns are worth a look. Omitted entirely when
   * nothing flagged so an older desktop parser sees no new key (back-compat).
   */
  warnings?: Array<{ slug: string; findings: UploadFinding[] }>;
  /** The resolved selection was empty — nothing to upload. */
  empty: boolean;
}

/** Resolve a requested slug to a kit-state key: exact match, else the promoted
 *  `@handle/<slug>` key sync re-keys own published skills to. */
function resolveStateKey(keys: string[], requested: string): string | null {
  if (keys.includes(requested)) return requested;
  if (requested.startsWith('@')) return null;
  const promoted = keys.filter((k) => k.startsWith('@') && k.endsWith(`/${requested}`));
  return promoted.length === 1 ? promoted[0]! : null;
}

export async function uploadLocalSkills(
  opts: UploadLocalSkillsOptions = {},
): Promise<UploadLocalSkillsResult> {
  const state = await readState();
  const keys = Object.keys(state.skills);

  let selected: string[];
  if (opts.slugs === undefined) {
    // First-backup expansion: local skills that have never been published.
    selected = Object.entries(state.skills)
      .filter(([, s]) => s.source === 'local' && !s.owner)
      .map(([key]) => key)
      .sort((a, b) => a.localeCompare(b));
  } else {
    selected = [
      ...new Set(
        opts.slugs
          .map((s) => resolveStateKey(keys, s.trim()))
          .filter((k): k is string => k !== null),
      ),
    ];
  }

  if (selected.length === 0) {
    return { ok: false, owner: '', published: [], failed: [], empty: true };
  }

  const published: UploadLocalSkillsResult['published'] = [];
  const failed: UploadLocalSkillsResult['failed'] = [];
  const warnings: NonNullable<UploadLocalSkillsResult['warnings']> = [];
  let owner = '';

  for (let index = 0; index < selected.length; index++) {
    const key = selected[index]!;
    opts.onProgress?.({ phase: 'start', slug: key, index, total: selected.length });
    try {
      const result = await publish(key, {
        ...(opts.registryUrl ? { registryUrl: opts.registryUrl } : {}),
        ...(opts.token ? { token: opts.token } : {}),
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        visibility: opts.visibility ?? 'private',
        sessionAuth: opts.sessionAuth ?? true,
      });
      owner = owner || result.owner;
      published.push({ slug: key, alreadyExists: result.alreadyExists });
      // The registry `flagged` (not quarantined) the published version: it
      // published, but the patterns are worth surfacing (R3). Record them so the
      // desktop can warn-not-block.
      if (result.serverScan?.status === 'flagged' && result.serverScan.findings.length > 0) {
        warnings.push({ slug: key, findings: toUploadFindings(result.serverScan.findings) });
      }
      opts.onProgress?.({
        phase: 'done',
        slug: key,
        alreadyExists: result.alreadyExists,
        owner: result.owner,
      });
    } catch (err) {
      const error = (err as Error).message;
      // A registry `scan_blocked` refusal (real secret or quarantine) carries the
      // structured findings on `PublishError.detail` (the 422 body); surface them
      // alongside the message so the desktop lists what to fix, not just a count.
      const findings =
        err instanceof PublishError && err.code === 'scan_blocked'
          ? toUploadFindings((err.detail as ScanBlockedBody | undefined)?.findings ?? [])
          : undefined;
      failed.push({ slug: key, error, ...(findings?.length ? { findings } : {}) });
      opts.onProgress?.({ phase: 'fail', slug: key, error });
    }
  }

  return {
    ok: published.length > 0,
    owner,
    published,
    failed,
    ...(warnings.length ? { warnings } : {}),
    empty: false,
  };
}
