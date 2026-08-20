import type { SyncKitGroupJson } from './sync-kit-plan.js';

/** Shared `--dry-run` flag definition for Commander commands that write to disk. */
export const DRY_RUN_OPTION = {
  flags: "--dry-run",
  description: "Show planned writes without mutating disk or registry state",
} as const;

export interface SyncDryRunPlan {
  dryRun: true;
  cwd: string;
  skillCount: number;
  syncedSkillSlugs: string[];
  kits: SyncKitGroupJson[];
  /** Universal baseline adapters (always targeted). */
  baselineAdapters: string[];
  /** Detected additional adapters beyond universal baseline. */
  detectedAdditionalAdapters: string[];
  /** All adapters that would receive a sync (baseline + detected additional). */
  detectedAdapters: string[];
  lockPath: string;
}
