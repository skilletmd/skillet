import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Adapter } from '@skillet/core';
import { findProjectRoot } from '@skillet/adapters-codex';
import {
  ADDITIONAL_ADAPTERS,
  BASELINE_GLOBAL_ADAPTERS,
  codexProjectAdapter,
} from './cli-context.js';

/** Names that always materialize (universal `.agents/skills`). */
export const BASELINE_ADAPTER_NAMES = ['codex', 'codex-project'] as const;

export type BaselineAdapterName = (typeof BASELINE_ADAPTER_NAMES)[number];

export function isBaselineAdapterName(name: string): name is BaselineAdapterName {
  return (BASELINE_ADAPTER_NAMES as readonly string[]).includes(name);
}

/**
 * Universal baseline: global `~/.agents/skills` plus repo `.agents/skills`
 * when cwd resolves a real project root (not the homedir-global collision).
 */
export async function baselineAdaptersForCwd(cwd: string): Promise<Adapter[]> {
  const baseline: Adapter[] = [...BASELINE_GLOBAL_ADAPTERS];
  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    return baseline;
  }

  const absRoot = join(projectRoot, '.agents', 'skills');
  const globalRoot = join(homedir(), '.agents', 'skills');
  if (resolve(absRoot) === resolve(globalRoot)) {
    return baseline;
  }

  baseline.push(codexProjectAdapter);
  return baseline;
}

export function baselineNamesForAdapters(adapters: Adapter[]): string[] {
  return adapters
    .map((a) => a.name)
    .filter((name) => isBaselineAdapterName(name));
}

export interface ResolvedAdapters {
  adapters: Adapter[];
  baselineNames: string[];
}

export async function resolveMaterializeAdapters(
  cwd: string,
  pickedAdditional: Adapter[],
): Promise<ResolvedAdapters> {
  const baseline = await baselineAdaptersForCwd(cwd);
  const baselineNames = baselineNamesForAdapters(baseline);
  const baselineSet = new Set(baselineNames);
  const additional = pickedAdditional.filter((a) => !baselineSet.has(a.name));
  return {
    adapters: [...baseline, ...additional],
    baselineNames,
  };
}

export async function resolveSyncAdapters(cwd: string): Promise<ResolvedAdapters> {
  const baseline = await baselineAdaptersForCwd(cwd);
  const baselineNames = baselineNamesForAdapters(baseline);
  const detectedAdditional: Adapter[] = [];

  for (const adapter of ADDITIONAL_ADAPTERS) {
    try {
      if (await adapter.detect()) {
        detectedAdditional.push(adapter);
      }
    } catch {
      // Non-fatal — skip adapters that fail detect.
    }
  }

  return {
    adapters: [...baseline, ...detectedAdditional],
    baselineNames,
  };
}

/** Names of the adapters whose detect() answers yes — concurrent, failures
 *  skipped. The one canonical "which agents are here" loop; every surface
 *  that needs the list calls this instead of re-rolling it. */
export async function detectAdapterNames(adapters: readonly Adapter[]): Promise<string[]> {
  const detected = await Promise.all(
    adapters.map((adapter) =>
      adapter
        .detect()
        .then((hit) => (hit ? adapter.name : null))
        .catch(() => null),
    ),
  );
  return detected.filter((name): name is string => name !== null);
}

/** Additional adapter names currently detected (for `-a` error messages). */
export async function detectAdditionalAdapterNames(): Promise<string[]> {
  return detectAdapterNames(ADDITIONAL_ADAPTERS);
}
