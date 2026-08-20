/** Visibility tier for a CLI command on the default install surface. */
export type SurfaceTier = 'root' | 'group' | 'hidden' | 'legacy';

export interface SurfaceRow {
  /** Stable command id (e.g. `device rename`, `add kit`). */
  command: string;
  usage: string;
  group: string;
  tier: SurfaceTier;
}

export interface HelpGroup {
  title: string;
  rows: Array<{ usage: string; description: string }>;
}

/**
 * Canonical visibility matrix for default `skillet --help`.
 * Single source for root rows, footer hints, and test assertions.
 */
export const ROOT_SURFACE: SurfaceRow[] = [
  {
    command: 'init',
    usage: 'init',
    group: 'Getting started',
    tier: 'root',
  },
  {
    command: 'connect',
    usage: 'connect <code>',
    group: 'Getting started',
    tier: 'root',
  },
  {
    command: 'web',
    usage: 'web [path]',
    group: 'Getting started',
    tier: 'root',
  },
  {
    command: 'whoami',
    usage: 'whoami',
    group: 'This machine',
    tier: 'root',
  },
  {
    command: 'logout',
    usage: 'logout',
    group: 'This machine',
    tier: 'root',
  },
  {
    command: 'import',
    usage: 'import [source]',
    group: 'Skills into your kit',
    tier: 'group',
  },
  {
    command: 'add',
    usage: 'add [source]',
    group: 'Skills into your kit',
    tier: 'root',
  },
  {
    command: 'add kit',
    usage: 'add kit <ref>',
    group: 'Skills into your kit',
    tier: 'group',
  },
  {
    command: 'search',
    usage: 'search <keyword...>',
    group: 'Skills into your kit',
    tier: 'root',
  },
  {
    command: 'list',
    usage: 'list',
    group: 'Skills into your kit',
    tier: 'root',
  },
  {
    command: 'sync',
    usage: 'sync',
    group: 'Sync & share',
    tier: 'root',
  },
  {
    command: 'scan',
    usage: 'scan',
    group: 'Sync & share',
    tier: 'group',
  },
  {
    command: 'mcp',
    usage: 'mcp',
    group: 'Sync & share',
    tier: 'root',
  },
  {
    command: 'route',
    usage: 'route',
    group: 'Sync & share',
    tier: 'hidden',
  },
  {
    command: 'upload',
    usage: 'upload',
    group: 'Sync & share',
    tier: 'root',
  },
  {
    command: 'export',
    usage: 'export <ref>',
    group: 'Sync & share',
    tier: 'root',
  },
  {
    command: 'usage',
    usage: 'usage',
    group: 'This machine',
    tier: 'root',
  },
  {
    command: 'activity',
    usage: 'activity',
    group: 'This machine',
    tier: 'root',
  },
  {
    command: 'device',
    usage: 'device',
    group: 'This machine',
    tier: 'root',
  },
  {
    command: 'doctor',
    usage: 'doctor',
    group: 'This machine',
    tier: 'root',
  },
  { command: 'agents', usage: 'agents', group: '', tier: 'group' },
  { command: 'runtimes', usage: 'runtimes', group: '', tier: 'group' },
  { command: 'pending', usage: 'pending', group: '', tier: 'group' },
  { command: 'approve', usage: 'approve', group: '', tier: 'group' },
  { command: 'reject', usage: 'reject', group: '', tier: 'group' },
  { command: 'edits', usage: 'edits', group: '', tier: 'group' },
  { command: 'restore', usage: 'restore', group: '', tier: 'group' },
  { command: 'sweep', usage: 'sweep', group: '', tier: 'group' },
  { command: 'avatar', usage: 'avatar', group: '', tier: 'hidden' },
  { command: 'auth', usage: 'auth', group: '', tier: 'group' },
  { command: 'trust', usage: 'trust', group: '', tier: 'hidden' },
  { command: 'pin', usage: 'pin', group: '', tier: 'hidden' },
  { command: 'update-mode', usage: 'update-mode', group: '', tier: 'hidden' },
  { command: 'status', usage: 'status', group: '', tier: 'hidden' },
  { command: 'publish', usage: 'publish', group: '', tier: 'legacy' },
];

/** Power-user commands surfaced in the root help footer, not as rows. */
export const ROOT_FOOTER_POWER_COMMANDS = [
  'import',
  'scan',
  'pending',
  'edits',
  'trust',
  'pin',
] as const;

const GROUP_ORDER = [
  'Getting started',
  'Skills into your kit',
  'Sync & share',
  'This machine',
] as const;

/**
 * Curated root help groups — device golden route only. Descriptions come from
 * the registered commands via `resolve`, so root help and `<cmd> --help` can
 * never drift apart: there is exactly one description per command, the one on
 * `.description()`. A row that fails to resolve is a registration bug —
 * surfaced loudly here (and pinned by help-surface.test.ts) instead of
 * advertising a command that doesn't exist.
 */
export function buildRootHelpGroups(resolve: (commandId: string) => string | null): HelpGroup[] {
  const byGroup = new Map<string, HelpGroup['rows']>();
  for (const row of ROOT_SURFACE) {
    if (row.tier !== 'root') continue;
    const description = resolve(row.command);
    if (description === null) {
      throw new Error(`root help advertises "${row.command}" but no such command is registered`);
    }
    const rows = byGroup.get(row.group) ?? [];
    rows.push({ usage: row.usage, description });
    byGroup.set(row.group, rows);
  }
  return GROUP_ORDER.filter((title) => byGroup.has(title)).map((title) => ({
    title,
    rows: byGroup.get(title)!,
  }));
}

/** Resolve a surface command id ("device rename", "add kit") to its registered
 *  Commander description. Returns null when the command doesn't exist. */
export function resolveCommandDescription(
  root: { commands: ReadonlyArray<{ name(): string; description(): string; commands: ReadonlyArray<unknown> }> },
  commandId: string,
): string | null {
  const parts = commandId.split(' ');
  let scope: { commands: ReadonlyArray<{ name(): string; description(): string; commands: ReadonlyArray<unknown> }> } = root;
  let found: { name(): string; description(): string; commands: ReadonlyArray<unknown> } | undefined;
  for (const part of parts) {
    found = scope.commands.find((c) => c.name() === part);
    if (!found) return null;
    scope = found as typeof scope;
  }
  return found ? found.description() : null;
}

export function rootHelpRowCount(): number {
  return ROOT_SURFACE.filter((row) => row.tier === 'root').length;
}

export function rootTierCommands(): string[] {
  return ROOT_SURFACE.filter((row) => row.tier === 'root').map((row) => row.command);
}
