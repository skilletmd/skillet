import type { Command } from 'commander';
import * as clack from '@clack/prompts';
import {
  add,
  importGitHubSkill,
  importSkill,
  loadRegistryBearer,
  loadSessionToken,
  materializeSkills,
  subscribeKitByHandle,
  findKitByHandle,
  type DiscoveredGitHubSkill,
} from '@skillet/core';
import {
  collect,
  REGISTRY_DEFAULT,
  renderAdapterLine,
} from '../cli-context.js';
import { webBaseUrl } from '../cli-command-tier.js';
import { authRequiredMessage, requirePaired } from '../auth-required.js';
import { exitWith, exitCodeForError } from '../exit-codes.js';
import { writeJsonError, writeJsonOk } from '../json-output.js';
import {
  configureAddPresent,
  printAddBanner,
  printAddError,
  printAddHint,
  printStepInfo,
  printStepSelect,
  printStepSuccess,
} from '../cli-add-present.js';
import {
  detectInstalledAdapters,
  formatAdapterList,
  pickAdapters,
  warnNoAdditionalRuntimes,
  type DetectedAdapter,
} from '../cli-add-adapters.js';
import { resolveMaterializeAdapters } from '../adapter-tiers.js';
import {
  discoverGithubForAdd,
  resolveAddSource,
} from '../cli-add-source.js';
import { selectSkills } from './import-cmd.js';

export interface AddFlowOptions {
  registry: string;
  ref?: string;
  skill: string[];
  list?: boolean;
  yes?: boolean;
  global?: boolean;
  adapter: string[];
  json?: boolean;
  token?: string;
  pin?: boolean;
  cwd?: string;
}

export interface AddFlowResult {
  kind: 'skill' | 'kit';
  source: string;
  skill?: string;
  skills?: string[];
  kit?: string;
  adapters: string[];
  synced: boolean;
  materialized: number;
}

/**
 * Kit subscribe needs a *session* token specifically (a device-paired machine
 * without a web session still can't subscribe). The generic unpaired case is
 * handled earlier by the command-entry pairing gate (requirePaired).
 */
function kitAuthMessage(): string {
  const web = webBaseUrl();
  return `Kit install requires a signed-in session. Sign in at ${web}, then run \`skillet connect <code>\` from ${web}/settings.`;
}

async function runPostInstallMaterialize(
  cwd: string,
  slugs: string[],
  adapters: DetectedAdapter[],
  opts: {
    token?: string;
    registryUrl: string;
    asJson: boolean;
    autoApprove: boolean;
    skipPull: boolean;
  },
): Promise<{ synced: boolean; materialized: number; adapterNames: string[] }> {
  const { adapters: adapterList, baselineNames } = await resolveMaterializeAdapters(
    cwd,
    adapters.map((a) => a.adapter),
  );
  const result = await materializeSkills(cwd, adapterList, {
    slugs,
    token: opts.token,
    registryUrl: opts.registryUrl,
    quietSkipLines: opts.asJson,
    autoApprove: opts.autoApprove,
    skipPull: opts.skipPull,
    pullMode: opts.skipPull ? 'unattended' : undefined,
    baselineAdapterNames: baselineNames,
  });
  const materialized = result.adapters.filter((a) => a.status === 'materialized').length;
  if (!opts.asJson) {
    console.log('');
    for (const r of result.adapters) {
      if (r.status !== 'skipped-not-detected') {
        console.log(renderAdapterLine(r));
      }
    }
  }
  return {
    synced: true,
    materialized,
    adapterNames: adapterList.map((a) => a.name),
  };
}

async function pickGithubSkillInteractive(
  skills: DiscoveredGitHubSkill[],
): Promise<DiscoveredGitHubSkill | null> {
  if (skills.length === 1) return skills[0] ?? null;
  const selected = await clack.select({
    message: 'Which skill do you want to install?',
    options: skills.map((s) => ({
      value: s.slug,
      label: s.slug,
      hint: s.description ?? undefined,
    })),
  });
  if (clack.isCancel(selected)) return null;
  const slug = selected as string;
  return skills.find((s) => s.slug === slug) ?? null;
}

export async function runSkillAddFlow(
  sourceInput: string | undefined,
  opts: AddFlowOptions,
): Promise<AddFlowResult> {
  const asJson = opts.json === true;
  const interactive = !asJson && process.stdin.isTTY === true && process.stdout.isTTY === true;
  configureAddPresent({ json: asJson });

  if (!asJson) {
    printAddBanner();
  }

  const resolved = await resolveAddSource(sourceInput);
  if (resolved.kind === 'missing') {
    throw new Error(
      sourceInput
        ? `Unrecognized source "${sourceInput}". Use a GitHub repo (owner/repo), @author/skill, or a local path.`
        : 'Source is required. Example: skillet add vercel-labs/skills --skill find-skills',
    );
  }

  if (!asJson) {
    printStepInfo(`Source: ${resolved.display}`);
  }

  let installedSlug: string;
  let installedName: string;

  if (resolved.kind === 'registry_skill' && resolved.registryRef) {
    const bearer = await loadRegistryBearer(opts.token);
    if (!bearer.token) {
      // Defensive: the command-entry pairing gate already exited unpaired runs.
      throw new Error(authRequiredMessage());
    }
    if (!asJson) {
      printStepSelect(`Selected: ${resolved.registryRef}`, resolved.registryRef);
    }
    const result = await add(resolved.registryRef, {
      registryUrl: opts.registry,
      token: bearer.token,
      pin: opts.pin === true,
    });
    installedSlug = result.entry.slug;
    installedName = result.entry.slug;
    if (!asJson && !result.noop) {
      printStepSuccess(`Added ${installedSlug} from registry`);
    }
  } else if (resolved.kind === 'github') {
    const discovery = await discoverGithubForAdd(resolved, { ref: opts.ref });
    if (discovery.skills.length === 0) {
      throw new Error(`No skills found in ${discovery.owner}/${discovery.repo}.`);
    }
    if (!asJson) {
      const label = discovery.skills.length === 1 ? 'skill' : 'skills';
      printStepInfo(`Found ${discovery.skills.length} ${label}`);
    }
    if (opts.list === true) {
      if (asJson) {
        return {
          kind: 'skill',
          source: resolved.display,
          skills: discovery.skills.map((s) => s.slug),
          adapters: [],
          synced: false,
          materialized: 0,
        };
      }
      for (const s of discovery.skills) {
        console.log(`  ${s.slug}${s.description ? ` — ${s.description}` : ''}`);
      }
      return {
        kind: 'skill',
        source: resolved.display,
        skills: discovery.skills.map((s) => s.slug),
        adapters: [],
        synced: false,
        materialized: 0,
      };
    }

    let chosen: DiscoveredGitHubSkill[];
    if (opts.skill.length > 0 || opts.yes === true || !interactive) {
      chosen = await selectSkills(discovery, { skill: opts.skill, all: opts.yes === true });
    } else {
      const one = await pickGithubSkillInteractive(discovery.skills);
      chosen = one ? [one] : [];
    }
    if (chosen.length === 0) {
      throw new Error('No skill selected.');
    }
    if (chosen.length > 1 && !asJson) {
      printStepSelect(`Selected ${chosen.length} skills: ${chosen.map((s) => s.slug).join(', ')}`);
    } else if (!asJson) {
      printStepSelect(`Selected: ${chosen[0]!.slug}`, chosen[0]!.slug);
    }

    if (chosen.length > 1) {
      throw new Error(
        'Single-install supports one skill at a time. Pick one with --skill or run again.',
      );
    }
    const skill = chosen[0]!;
    const entry = await importGitHubSkill(discovery, skill);
    installedSlug = entry.slug;
    installedName = entry.name;
    if (!asJson) {
      printStepSuccess(`Imported "${installedName}" as ${installedSlug}`);
    }
  } else if (resolved.kind === 'local_path' && resolved.localPath) {
    const entry = await importSkill(resolved.localPath);
    installedSlug = entry.slug;
    installedName = entry.name;
    if (!asJson) {
      printStepSelect(`Selected: ${installedSlug}`, installedSlug);
      printStepSuccess(`Imported "${installedName}" as ${installedSlug}`);
    }
  } else {
    throw new Error('Unsupported source type.');
  }

  const cwd = opts.cwd ?? process.cwd();
  const detected = await detectInstalledAdapters();
  const picked = await pickAdapters(detected, {
    yes: opts.yes,
    adapterFlags: opts.adapter,
    interactive,
    global: opts.global,
    cwd,
  });

  if (detected.length === 0 && !asJson) {
    warnNoAdditionalRuntimes();
  }

  const bearer = await loadRegistryBearer(opts.token);
  const syncResult = await runPostInstallMaterialize(cwd, [installedSlug], picked, {
    token: bearer.token || undefined,
    registryUrl: opts.registry,
    asJson,
    autoApprove: opts.yes === true,
    skipPull: true,
  });

  if (!asJson) {
    printStepSuccess(
      `Installed ${installedSlug} → synced to ${syncResult.materialized} agent(s) (${formatAdapterList(picked)})`,
    );
    if (resolved.kind !== 'registry_skill') {
      printAddHint('On this machine only for now. Put it on your other machines with `skillet upload`');
    }
  }

  return {
    kind: 'skill',
    source: resolved.display,
    skill: installedSlug,
    adapters: syncResult.adapterNames,
    synced: syncResult.synced,
    materialized: syncResult.materialized,
  };
}

/**
 * Does this `add` source resolve to a kit? Only `@owner/slug` refs can, and
 * only when we hold a session bearer (kit reads/subscribes are session-scoped).
 * A read-only probe: null/404 → not a kit → the skill flow handles it.
 */
async function sourceIsKit(source: string | undefined, opts: AddFlowOptions): Promise<boolean> {
  const ref = source?.trim();
  if (!ref || !ref.startsWith('@')) return false;
  const session = await loadSessionToken(opts.token);
  if (!session || !session.startsWith('skillet_s_')) return false;
  const kit = await findKitByHandle(ref, {
    registryUrl: opts.registry,
    token: session,
  });
  return kit !== null;
}

export async function runKitAddFlow(ref: string, opts: AddFlowOptions): Promise<AddFlowResult> {
  const asJson = opts.json === true;
  const interactive = !asJson && process.stdin.isTTY === true && process.stdout.isTTY === true;
  configureAddPresent({ json: asJson });

  if (!asJson) {
    printAddBanner();
  }

  const session = await loadSessionToken(opts.token);
  if (!session || !session.startsWith('skillet_s_')) {
    throw new Error(kitAuthMessage());
  }

  if (!asJson) {
    printStepInfo(`Kit: ${ref.startsWith('@') ? ref : `@${ref}`}`);
  }

  const sub = await subscribeKitByHandle(ref, {
    registryUrl: opts.registry,
    token: session,
  });

  if (!asJson) {
    printStepInfo(`Found kit "${sub.kitName}" with ${sub.skillCount} skill(s)`);
    if (sub.alreadySubscribed) {
      printStepSelect(`Already subscribed to ${sub.kitName}`);
    } else {
      printStepSuccess(`Subscribed to ${sub.kitName}`);
    }
  }

  const cwd = opts.cwd ?? process.cwd();
  const detected = await detectInstalledAdapters();
  const picked = await pickAdapters(detected, {
    yes: opts.yes,
    adapterFlags: opts.adapter,
    interactive,
    global: opts.global,
    cwd,
  });

  if (detected.length === 0 && !asJson) {
    warnNoAdditionalRuntimes();
  }

  const syncResult = await runPostInstallMaterialize(cwd, sub.skillRefs, picked, {
    token: session,
    registryUrl: opts.registry,
    asJson,
    autoApprove: opts.yes === true,
    skipPull: false,
  });

  const kitRef = `@${sub.owner}/${sub.slug}`;
  if (!asJson) {
    printStepSuccess(
      `Kit ${kitRef} → synced to ${syncResult.materialized} agent(s) (${formatAdapterList(picked)})`,
    );
  }

  return {
    kind: 'kit',
    source: kitRef,
    kit: kitRef,
    adapters: syncResult.adapterNames,
    synced: syncResult.synced,
    materialized: syncResult.materialized,
  };
}

function sharedAddOptions(cmd: Command): void {
  cmd
    .option('--registry <url>', 'Registry base URL', REGISTRY_DEFAULT)
    .option('--ref <ref>', 'GitHub branch, tag, or commit')
    .option(
      '--skill <name>',
      'Install only the named skill(s) from a repo; repeatable',
      collect,
      [] as string[],
    )
    .option('--list', 'List discoverable skills without installing')
    .option('-y, --yes', 'Skip prompts; use defaults')
    .option('-g, --global', 'Install only to Universal ~/.agents/skills (skip other agents)')
    .option('-a, --adapter <name>', 'Target agent(s) by name; repeatable', collect, [] as string[])
    .option('--json', 'Machine-readable output')
    .option('--token <token>', 'Bearer token override')
    .option('--pin', 'Pin registry skill to current version')
    .option('--cwd <dir>', 'Working directory for skillet.lock', process.cwd());
}

export function registerAddCommand(program: Command): void {
  const addCmd = program
    .command('add [source]')
    .description('Add a skill or kit from the library, GitHub, or a path');

  sharedAddOptions(addCmd);

  addCmd.action(async (source: string | undefined, opts: AddFlowOptions) => {
    // Pairing gate for EVERY source branch (GitHub, local path, registry) —
    // unpaired machines never fetch, prompt, or write the kit. The gate
    // precedes source resolution, so no GitHub/registry request is attempted.
    // In --json mode the auth_required envelope goes to stdout (sidecar contract).
    await requirePaired(opts.token, { json: opts.json === true });
    try {
      // A bare `@owner/slug` can name a kit or a skill. Probe the kit namespace
      // first (read-only, session bearer); on a hit, subscribe it as a kit,
      // otherwise install it as a skill. GitHub URLs and local paths are never
      // kits, so only `@`-refs are probed — one verb, `add`, covers both.
      if (await sourceIsKit(source, opts)) {
        const result = await runKitAddFlow(source!.trim(), opts);
        if (opts.json === true) {
          writeJsonOk(result);
        }
        return;
      }
      const result = await runSkillAddFlow(source, opts);
      if (opts.json === true) {
        writeJsonOk(result);
      }
    } catch (err) {
      const message = (err as Error).message;
      // A revoked device / stale session (registry 401/403) exits AUTH, a stale
      // base 409 exits CONFLICT — not the generic ERROR — so scripts and the
      // tray route them correctly. The local pairing gate above only catches a
      // missing token, not a server-rejected one.
      const exit = exitCodeForError(err);
      if (opts.json === true) {
        writeJsonError(message, { exitCode: exit });
      } else {
        printAddError(message);
        exitWith(exit);
      }
    }
  });

  // `add kit <ref>` stays as an explicit escape hatch (and the scripting/tray
  // contract), but it is off the root help surface: bare `add` auto-detects.
  const kitCmd = addCmd
    .command('kit <ref>')
    .description('Subscribe to a kit and sync its skills');

  sharedAddOptions(kitCmd);

  kitCmd.action(async (ref: string, opts: AddFlowOptions) => {
    // Same pairing gate as `add` — kit subscribe is a kit-write path too.
    await requirePaired(opts.token, { json: opts.json === true });
    try {
      const result = await runKitAddFlow(ref, opts);
      if (opts.json === true) {
        writeJsonOk(result);
      }
    } catch (err) {
      const message = (err as Error).message;
      // A revoked device / stale session (registry 401/403) exits AUTH, a stale
      // base 409 exits CONFLICT — not the generic ERROR — so scripts and the
      // tray route them correctly. The local pairing gate above only catches a
      // missing token, not a server-rejected one.
      const exit = exitCodeForError(err);
      if (opts.json === true) {
        writeJsonError(message, { exitCode: exit });
      } else {
        printAddError(message);
        exitWith(exit);
      }
    }
  });
}
