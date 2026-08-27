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
import { describeTccRoot, detectTccInvocation } from '../util/tcc-access.js';
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

export interface DoctorReportFolderAccessEntry {
  name: string;
  target_dir: string;
  /** The realpath'd protected folder the root resolves under. */
  anchor: string | null;
  grant: 'active' | 'suspended' | 'none';
}

/**
 * macOS folder access, per adapter root.
 *
 * `context` is the TCC identity this report describes. macOS attributes a
 * grant to the responsible app, so one earned under the desktop tray says
 * nothing about the terminal's and vice versa. A support paste that does not
 * name which identity it means is worse than no paste at all.
 *
 * `entries` lists only roots that actually resolve under a protected folder.
 * A normal install has none, and a diagnostic that prints a row per adapter
 * saying "fine" is noise in the 99% case.
 */
export interface DoctorReportFolderAccess {
  context: 'desktop' | 'cli';
  entries: DoctorReportFolderAccessEntry[];
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
  folder_access: DoctorReportFolderAccess;
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
    folder_access: collectFolderAccess(adapters),
  };
}

/**
 * Protected adapter roots and what this identity may do with them.
 *
 * Reported through describeTccRoot, never assessTccRoot: a diagnostic that
 * raised the macOS consent dialog would be a diagnostic nobody could run
 * safely. Only protected roots are listed, so a normal install reports an
 * empty list and the human formatter prints nothing.
 *
 * Project adapters are skipped, matching the TCC gate in sync(). Their
 * targetDir is a RELATIVE path under the project cwd (`.cursor/rules`), so
 * resolving it here would describe wherever the command happened to run. Any
 * checkout inside ~/Documents would then report every project adapter as
 * needing folder access, which is both wrong and unactionable: sync never
 * parks a project adapter, and the consent that matters belongs to the repo,
 * not to Skillet.
 */
function collectFolderAccess(adapters: Adapter[]): DoctorReportFolderAccess {
  const { context } = detectTccInvocation();
  const entries: DoctorReportFolderAccessEntry[] = [];
  const seenAnchors = new Set<string>();
  for (const adapter of adapters) {
    if (adapter.kind === 'project') continue;
    const access = describeTccRoot(adapter.targetDir, context);
    if (!access.protected) continue;
    // One row per adapter, but never two rows for one anchor+root pair —
    // several adapters can share a skills dir (the universal baseline).
    const key = `${adapter.name}:${access.anchor ?? ''}:${adapter.targetDir}`;
    if (seenAnchors.has(key)) continue;
    seenAnchors.add(key);
    entries.push({
      name: adapter.name,
      target_dir: adapter.targetDir,
      anchor: access.anchor,
      grant: access.grant,
    });
  }
  return { context, entries };
}
