/**
 * `skillet doctor` — one-shot diagnostic for auth, sync state, and pending updates.
 */
import { join } from 'node:path';
import type { Adapter } from '../adapter.js';
import { authStatus, type AuthStatus, type AuthStatusOptions } from './auth-status.js';
import { listPending } from './pending.js';
import { readEditedReported, readState, readBundleFromSkillStore } from '../kit/store.js';
import { readSkillStoreContentHash, skillStoreDirExists } from '../kit/store-integrity.js';
import { resolveSkillDescription } from '../kit/skill-description.js';
import { isKitSyncedSkill } from '../kit/sync-scope.js';
import matter from 'gray-matter';
import { defaultApprovalLockPath } from '../trust/approval-lock.js';
import { listPinnedHandles, defaultPinDir } from '../signing/pin.js';
import {
  deviceFilePath,
  readActiveDeviceFile,
} from '../device-token.js';
import {
  envSessionToken,
  envSessionTokenForceActive,
  sessionFilePath,
  sessionTokenPrecedenceMode,
  skilletDir,
  type SessionTokenPrecedence,
} from '../session-token.js';

export const DOCTOR_REPORT_SCHEMA = 'doctor_report/v1' as const;

export type { SessionTokenPrecedence };

export interface DoctorReportPaths {
  skillet_dir: string;
  session_file: string;
  device_file: string;
  state_file: string;
  approval_lock: string;
  pin_dir: string;
}

export interface DoctorReportEnv {
  skillet_daemon: boolean;
  skillet_registry_url: string | null;
  skillet_token_set: boolean;
  skillet_token_force: boolean;
  skillet_dir_override: boolean;
  session_token_precedence: SessionTokenPrecedence;
}

export interface DoctorReportState {
  skill_count: number;
  slugs_sample: string[];
  edited_reported: boolean;
}

export interface DoctorReportPending {
  count: number;
  slugs: string[];
}

export interface DoctorReportPins {
  handles: string[];
}

export interface DoctorReportDevice {
  file_present: boolean;
  device_id: string | null;
  label: string | null;
}

export interface DoctorReportStoreDrift {
  slug: string;
  entry_hash: string;
  store_hash: string | null;
}

export interface DoctorReportStoreMissing {
  slug: string;
}

export interface DoctorReportCursorDescription {
  slug: string;
  source: 'frontmatter' | 'entry' | 'body' | 'slug';
  resolved_description: string;
}

export interface DoctorReport {
  schema: typeof DOCTOR_REPORT_SCHEMA;
  generated_at: string;
  paths: DoctorReportPaths;
  env: DoctorReportEnv;
  auth: AuthStatus;
  state: DoctorReportState;
  pending: DoctorReportPending;
  pins: DoctorReportPins;
  device: DoctorReportDevice;
  store_drift: DoctorReportStoreDrift[];
  store_missing: DoctorReportStoreMissing[];
  cursor_description_synthesis: DoctorReportCursorDescription[];
}

export interface DoctorReportOptions extends AuthStatusOptions {
  adapters?: Adapter[];
  cwd?: string;
  /** Cap slugs listed in state/pending samples for support dumps. */
  sampleLimit?: number;
}

function envRegistryUrl(): string | null {
  return process.env['SKILLET_REGISTRY_URL'] ?? process.env['SKILLET_REGISTRY'] ?? null;
}

function sampleSlugs(slugs: string[], limit: number): string[] {
  return slugs.slice(0, limit).sort((a, b) => a.localeCompare(b));
}

/** Gather a redacted diagnostic snapshot for support and automation. */
export async function collectDoctorReport(
  opts: DoctorReportOptions = {},
): Promise<DoctorReport> {
  const sampleLimit = opts.sampleLimit ?? 12;
  const adapters = opts.adapters ?? [];
  const dir = skilletDir();

  const [auth, state, editedReported, pendingResult, pinHandles, deviceFile, precedence] =
    await Promise.all([
      authStatus(opts),
      readState(),
      readEditedReported(),
      listPending(adapters, { cwd: opts.cwd }),
      listPinnedHandles(),
      readActiveDeviceFile(),
      sessionTokenPrecedenceMode(opts.token),
    ]);

  const skillSlugs = Object.keys(state.skills);

  const storeDrift: DoctorReportStoreDrift[] = [];
  const storeMissing: DoctorReportStoreMissing[] = [];
  const cursorDescriptionSynthesis: DoctorReportCursorDescription[] = [];

  for (const slug of skillSlugs) {
    try {
      if (!(await skillStoreDirExists(slug))) {
        storeMissing.push({ slug });
      }
    } catch {
      // We treat an inaccessible store directory as a missing-store
      // diagnostics entry so the report still completes.
      storeMissing.push({ slug });
    }
  }

  for (const slug of skillSlugs) {
    const entry = state.skills[slug];
    if (!entry || entry.source !== 'registry' || !entry.hash) continue;
    const storeHash = await readSkillStoreContentHash(slug);
    if (storeHash === entry.hash) continue;
    storeDrift.push({
      slug,
      entry_hash: entry.hash,
      store_hash: storeHash,
    });
  }

  for (const slug of skillSlugs) {
    const entry = state.skills[slug];
    if (!entry || !isKitSyncedSkill(entry)) continue;
    try {
      const bundle = await readBundleFromSkillStore(slug);
      const skillMd = bundle.get('SKILL.md');
      if (!skillMd) continue;
      const parsed = matter(Buffer.from(skillMd).toString('utf8'));
      const fm = parsed.data as Record<string, unknown>;
      const frontmatterDescription =
        typeof fm.description === 'string' ? fm.description : undefined;
      const resolved = resolveSkillDescription({
        frontmatterDescription,
        optsDescription: entry.description,
        body: parsed.content,
        slug: entry.name || slug,
      });
      if (resolved.source === 'frontmatter') continue;
      cursorDescriptionSynthesis.push({
        slug,
        source: resolved.source,
        resolved_description: resolved.description,
      });
    } catch {
      // Best-effort diagnostic only.
    }
  }

  return {
    schema: DOCTOR_REPORT_SCHEMA,
    generated_at: new Date().toISOString(),
    paths: {
      skillet_dir: dir,
      session_file: sessionFilePath(),
      device_file: deviceFilePath(),
      state_file: join(dir, 'state.json'),
      approval_lock: defaultApprovalLockPath(),
      pin_dir: defaultPinDir(),
    },
    env: {
      skillet_daemon: process.env['SKILLET_DAEMON'] === '1',
      skillet_registry_url: envRegistryUrl(),
      skillet_token_set: envSessionToken().length > 0,
      skillet_token_force: envSessionTokenForceActive(),
      skillet_dir_override: process.env['SKILLET_DIR'] !== undefined,
      session_token_precedence: precedence,
    },
    auth,
    state: {
      skill_count: skillSlugs.length,
      slugs_sample: sampleSlugs(skillSlugs, sampleLimit),
      edited_reported: editedReported,
    },
    pending: {
      count: pendingResult.pending.length,
      slugs: sampleSlugs(
        pendingResult.pending.map((entry) => entry.slug),
        sampleLimit,
      ),
    },
    pins: {
      handles: pinHandles.sort((a, b) => a.localeCompare(b)),
    },
    device: {
      file_present: deviceFile !== null,
      device_id: deviceFile?.device_id ?? null,
      label: deviceFile?.label ?? null,
    },
    store_drift: storeDrift,
    store_missing: storeMissing,
    cursor_description_synthesis: cursorDescriptionSynthesis,
  };
}
