import type { Adapter } from '@skillet/core';
import { runtimeLabel } from '@skillet/core';
import * as clack from '@clack/prompts';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ADDITIONAL_ADAPTERS } from './cli-context.js';
import { baselineAdaptersForCwd, isBaselineAdapterName } from './adapter-tiers.js';
import { dim } from './cli-colors.js';

export interface DetectedAdapter {
  adapter: Adapter;
  name: string;
  label: string;
  pathHint: string;
}

function adapterPathHint(adapter: Adapter): string {
  return adapter.targetDir;
}

export async function detectInstalledAdapters(): Promise<DetectedAdapter[]> {
  const detected: DetectedAdapter[] = [];
  for (const adapter of ADDITIONAL_ADAPTERS) {
    try {
      if (await adapter.detect()) {
        detected.push({
          adapter,
          name: adapter.name,
          label: runtimeLabel(adapter.name),
          pathHint: adapterPathHint(adapter),
        });
      }
    } catch {
      // Non-fatal — skip adapters that fail detect.
    }
  }
  return detected;
}

export interface PickAdaptersOptions {
  yes?: boolean;
  adapterFlags?: string[];
  interactive?: boolean;
  /** Install only to universal baseline; skip additional runtimes. */
  global?: boolean;
  cwd?: string;
}

function pickByFlags(
  detected: DetectedAdapter[],
  wanted: Set<string>,
): DetectedAdapter[] {
  const additionalWanted = [...wanted].filter((w) => !isBaselineAdapterName(w));
  const wantedSet = new Set(additionalWanted);
  const picked = detected.filter((d) => wantedSet.has(d.name));
  const missing = additionalWanted.filter((w) => !picked.some((p) => p.name === w));
  if (missing.length > 0) {
    throw new Error(
      `Unknown or undetected agent(s): ${missing.join(', ')}. Detected additional: ${detected.map((d) => d.name).join(', ') || '(none)'}. Universal ~/.agents/skills is always included.`,
    );
  }
  return picked;
}

async function printUniversalBaseline(cwd: string): Promise<boolean> {
  const homeAgents = join(homedir(), '.agents', 'skills');
  console.log(dim(`Universal (${homeAgents}), always included`));
  const baseline = await baselineAdaptersForCwd(cwd);
  const hasProject = baseline.some((a) => a.name === 'codex-project');
  if (hasProject) {
    console.log(dim('Universal (./.agents/skills), always included for this project'));
  }
  return hasProject;
}

async function pickAdditionalInteractive(
  detected: DetectedAdapter[],
  cwd: string,
): Promise<DetectedAdapter[]> {
  await printUniversalBaseline(cwd);

  if (detected.length === 0) {
    return [];
  }

  const additionalPick = await clack.multiselect({
    message: 'Also install to which agents?',
    options: detected.map((d) => ({
      value: d.name,
      label: d.label,
      hint: d.pathHint,
    })),
    required: false,
  });
  if (clack.isCancel(additionalPick)) {
    throw new Error('Install cancelled.');
  }

  const names = new Set(additionalPick as string[]);
  return detected.filter((d) => names.has(d.name));
}

export async function pickAdapters(
  detected: DetectedAdapter[],
  opts: PickAdaptersOptions,
): Promise<DetectedAdapter[]> {
  const cwd = opts.cwd ?? process.cwd();

  if (opts.adapterFlags && opts.adapterFlags.length > 0) {
    const wanted = new Set(opts.adapterFlags.map((a) => a.toLowerCase()));
    return pickByFlags(detected, wanted);
  }

  if (opts.global === true || opts.yes === true || opts.interactive === false) {
    return [];
  }

  if (detected.length === 0) {
    await printUniversalBaseline(cwd);
    return [];
  }

  if (detected.length === 1) {
    await printUniversalBaseline(cwd);
    const only = detected[0]!;
    const pickOne = await clack.confirm({
      message: `Also install to ${only.label}?`,
      initialValue: false,
    });
    if (clack.isCancel(pickOne)) {
      throw new Error('Install cancelled.');
    }
    return pickOne ? [only] : [];
  }

  return pickAdditionalInteractive(detected, cwd);
}

export function formatAdapterList(adapters: DetectedAdapter[]): string {
  if (adapters.length === 0) return 'Universal only';
  return `Universal + ${adapters.map((a) => a.label).join(', ')}`;
}

export function warnNoAdditionalRuntimes(): void {
  console.log(
    dim(
      'No other agents detected. Installed to Universal ~/.agents/skills only; run `skillet sync` after installing another agent.',
    ),
  );
}

/** @internal test helper */
export function partitionAdapters(detected: DetectedAdapter[]): {
  additional: DetectedAdapter[];
} {
  return { additional: detected };
}
