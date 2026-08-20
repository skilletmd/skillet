import type { Adapter } from '../adapter.js';
import {
  sync,
  type AdapterResult,
  type SyncOptions,
} from './sync.js';

export interface MaterializeSkillsOptions extends SyncOptions {
  /** Skill slugs to write (e.g. `@author/skill`). Required. */
  slugs: string[];
  /**
   * When true (default), skip registry pull before materialize. Skill `add`
   * sets this after `add()` / import. Kit `add` sets false so union pull runs.
   */
  skipPull?: boolean;
}

export interface MaterializeSkillsResult {
  materialized: Array<{ slug: string; dest: string; hash: string }>;
  adapters: AdapterResult[];
  failed: Array<{ slug: string; reason: string }>;
  lockPath: string;
}

/**
 * Materialize an explicit slug set into the given adapters without syncing
 * the whole kit. Used by `skillet add` and `skillet add kit`.
 */
export async function materializeSkills(
  cwd: string,
  adapters: Adapter[],
  opts: MaterializeSkillsOptions,
): Promise<MaterializeSkillsResult> {
  if (opts.slugs.length === 0) {
    return { materialized: [], adapters: [], failed: [], lockPath: '' };
  }

  const skipPull = opts.skipPull !== false;
  const result = await sync(cwd, adapters, {
    ...opts,
    slugs: opts.slugs,
    skipPull,
    pullMode: skipPull ? 'unattended' : opts.pullMode,
  });

  return {
    materialized: result.materialized,
    adapters: result.adapters,
    failed: result.failed,
    lockPath: result.lockPath,
  };
}
