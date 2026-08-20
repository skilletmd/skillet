import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  isSkilletRouteHookCommand,
  recorderHookCommand,
  tccParkedConfigDir,
} from "./shared.js";

export interface CursorRouteHookInstallOptions {
  cursorDir?: string;
  recorderCommand: string;
}

export interface CursorRouteHookInstallResult {
  hooksPath: string;
  command: string;
  installed: boolean;
}

interface HookEntry {
  command: string;
  type?: "command" | "prompt";
  matcher?: string;
  timeout?: number;
  failClosed?: boolean;
}

interface CursorHooksFile {
  version: 1;
  hooks: Record<string, HookEntry[]>;
}

const HOOK_EVENT = "beforeSubmitPrompt";
const HOOK_MATCHER = "UserPromptSubmit";

function cursorHooksPath(cursorDir = join(homedir(), ".cursor")): string {
  return join(cursorDir, "hooks.json");
}

function parseHooksFile(raw: string): CursorHooksFile {
  const parsed = JSON.parse(raw) as Partial<CursorHooksFile>;
  return {
    version: 1,
    hooks:
      parsed.hooks && typeof parsed.hooks === "object" && !Array.isArray(parsed.hooks)
        ? parsed.hooks
        : {},
  };
}

async function readHooksFile(path: string): Promise<CursorHooksFile> {
  try {
    return parseHooksFile(await readFile(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, hooks: {} };
    }
    throw err;
  }
}

export async function installCursorRouteHook(
  opts: CursorRouteHookInstallOptions,
): Promise<CursorRouteHookInstallResult> {
  const cursorDir = opts.cursorDir ?? join(homedir(), ".cursor");
  const hooksPath = cursorHooksPath(cursorDir);
  const command = recorderHookCommand(opts.recorderCommand, "cursor");
  // TCC policy (U2): a parked config dir gets no hooks read/write.
  // Reported as skipped, not an error. Shared gate: see tccParkedConfigDir.
  if (tccParkedConfigDir(cursorDir)) {
    return { hooksPath, command, installed: false };
  }
  const hooksFile = await readHooksFile(hooksPath);
  const current = hooksFile.hooks[HOOK_EVENT] ?? [];
  const nextEntries = current.filter((entry) => !isSkilletRouteHookCommand(entry.command));
  nextEntries.push({
    command,
    matcher: HOOK_MATCHER,
    timeout: 3,
    failClosed: false,
  });
  hooksFile.hooks[HOOK_EVENT] = nextEntries;

  await mkdir(cursorDir, { recursive: true, mode: 0o700 });
  await writeFile(hooksPath, JSON.stringify(hooksFile, null, 2) + "\n", "utf8");

  return { hooksPath, command, installed: true };
}
