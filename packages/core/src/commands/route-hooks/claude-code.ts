import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  isSkilletRouteHookCommand,
  recorderHookCommand,
  tccParkedConfigDir,
} from "./shared.js";

export interface ClaudeCodeRouteHookInstallOptions {
  claudeDir?: string;
  recorderCommand: string;
}

export interface ClaudeCodeRouteHookInstallResult {
  settingsPath: string;
  command: string;
  installed: boolean;
}

interface ClaudeCommandHook {
  type: "command";
  command: string;
  timeout?: number;
}

interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeCommandHook[];
}

interface ClaudeSettingsFile {
  hooks?: Record<string, ClaudeHookGroup[]>;
  [key: string]: unknown;
}

const HOOK_EVENT = "UserPromptSubmit";

function claudeSettingsPath(claudeDir = join(homedir(), ".claude")): string {
  return join(claudeDir, "settings.json");
}

async function readSettings(path: string): Promise<ClaudeSettingsFile> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ClaudeSettingsFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

function skilletHook(command: string): ClaudeCommandHook {
  return { type: "command", command, timeout: 3 };
}

export async function installClaudeCodeRouteHook(
  opts: ClaudeCodeRouteHookInstallOptions,
): Promise<ClaudeCodeRouteHookInstallResult> {
  const claudeDir = opts.claudeDir ?? join(homedir(), ".claude");
  const settingsPath = claudeSettingsPath(claudeDir);
  const command = recorderHookCommand(opts.recorderCommand, "claude-code");
  // TCC policy (U2): a parked config dir gets no settings read/write.
  // Reported as skipped, not an error. Shared gate: see tccParkedConfigDir.
  if (tccParkedConfigDir(claudeDir)) {
    return { settingsPath, command, installed: false };
  }
  const settings = await readSettings(settingsPath);
  const hooks = settings.hooks ?? {};
  const groups = hooks[HOOK_EVENT] ?? [];

  const cleanedGroups: ClaudeHookGroup[] = groups.map((group) => ({
    ...group,
    hooks: (group.hooks ?? []).filter(
      (entry) => !isSkilletRouteHookCommand(entry.command),
    ),
  }));

  const targetGroup =
    cleanedGroups.find((group) => group.matcher === "" || group.matcher === undefined) ??
    cleanedGroups[0];

  if (targetGroup) {
    targetGroup.hooks.push(skilletHook(command));
  } else {
    cleanedGroups.push({
      matcher: "",
      hooks: [skilletHook(command)],
    });
  }

  settings.hooks = { ...hooks, [HOOK_EVENT]: cleanedGroups };

  await mkdir(claudeDir, { recursive: true, mode: 0o700 });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + "\n", "utf8");

  return { settingsPath, command, installed: true };
}
