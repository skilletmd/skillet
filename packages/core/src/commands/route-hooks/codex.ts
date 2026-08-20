import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  isSkilletRouteHookCommand,
  recorderHookCommand,
  tccParkedConfigDir,
} from "./shared.js";

export interface CodexRouteHookInstallOptions {
  codexDir?: string;
  recorderCommand: string;
}

export interface CodexRouteHookInstallResult {
  hooksPath: string;
  configPath: string;
  command: string;
  installed: boolean;
}

interface CodexCommandHook {
  type: "command";
  command: string;
  timeout?: number;
}

interface CodexHookGroup {
  hooks: CodexCommandHook[];
}

interface CodexHooksFile {
  hooks?: Record<string, CodexHookGroup[]>;
}

const HOOK_EVENT = "UserPromptSubmit";

function codexDirPath(codexDir = join(homedir(), ".codex")): string {
  return codexDir;
}

function codexHooksPath(codexDir: string): string {
  return join(codexDir, "hooks.json");
}

function codexConfigPath(codexDir: string): string {
  return join(codexDir, "config.toml");
}

async function readHooksFile(path: string): Promise<CodexHooksFile> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as CodexHooksFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

export function ensureCodexHooksFeatureFlag(raw: string): string {
  if (/^\s*codex_hooks\s*=\s*true\s*$/m.test(raw)) {
    return raw.endsWith("\n") ? raw : `${raw}\n`;
  }

  const featuresMatch = raw.match(/^\[features\]\s*$/im);
  if (featuresMatch) {
    const lines = raw.split("\n");
    const out: string[] = [];
    let inserted = false;
    for (let i = 0; i < lines.length; i++) {
      out.push(lines[i] ?? "");
      if (/^\[features\]\s*$/i.test(lines[i] ?? "")) {
        const next = lines[i + 1] ?? "";
        if (!/^\s*codex_hooks\s*=/.test(next)) {
          out.push("codex_hooks = true");
          inserted = true;
        }
      }
    }
    if (inserted) {
      return out.join("\n").endsWith("\n") ? out.join("\n") : `${out.join("\n")}\n`;
    }
  }

  const trimmed = raw.trimEnd();
  const suffix = trimmed.length > 0 ? "\n\n" : "";
  return `${trimmed}${suffix}[features]\ncodex_hooks = true\n`;
}

async function readConfig(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw err;
  }
}

function skilletHook(command: string): CodexCommandHook {
  return { type: "command", command, timeout: 3 };
}

export async function installCodexRouteHook(
  opts: CodexRouteHookInstallOptions,
): Promise<CodexRouteHookInstallResult> {
  const dir = codexDirPath(opts.codexDir);
  const hooksPath = codexHooksPath(dir);
  const configPath = codexConfigPath(dir);
  const command = recorderHookCommand(opts.recorderCommand, "codex");

  // TCC policy (U2): a parked config dir gets no config/hooks read/write.
  // Reported as skipped, not an error. Shared gate: see tccParkedConfigDir.
  if (tccParkedConfigDir(dir)) {
    return { hooksPath, configPath, command, installed: false };
  }

  const configRaw = await readConfig(configPath);
  const nextConfig = ensureCodexHooksFeatureFlag(configRaw);

  const hooksFile = await readHooksFile(hooksPath);
  const eventHooks = hooksFile.hooks ?? {};
  const groups = eventHooks[HOOK_EVENT] ?? [];
  const cleanedGroups: CodexHookGroup[] = groups.map((group) => ({
    hooks: (group.hooks ?? []).filter(
      (entry) => !isSkilletRouteHookCommand(entry.command),
    ),
  }));

  if (cleanedGroups.length === 0) {
    cleanedGroups.push({ hooks: [skilletHook(command)] });
  } else {
    cleanedGroups[0]?.hooks.push(skilletHook(command));
  }

  hooksFile.hooks = { ...eventHooks, [HOOK_EVENT]: cleanedGroups };

  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(configPath, nextConfig, "utf8");
  await writeFile(hooksPath, JSON.stringify(hooksFile, null, 2) + "\n", "utf8");

  return { hooksPath, configPath, command, installed: true };
}
