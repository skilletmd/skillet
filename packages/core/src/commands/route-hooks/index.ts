import { installClaudeCodeRouteHook } from "./claude-code.js";
import { installCodexRouteHook } from "./codex.js";
import { installCursorRouteHook } from "./cursor.js";
import { isHookCapableRuntime } from "./runtime-specs.js";

export {
  hookRuntimesFromDetected,
  isHookCapableRuntime,
  HOOK_CAPABLE_RUNTIMES,
  type HookCapableRuntime,
} from "./runtime-specs.js";
export {
  installCursorRouteHook,
  type CursorRouteHookInstallOptions,
  type CursorRouteHookInstallResult,
} from "./cursor.js";
export {
  installClaudeCodeRouteHook,
  type ClaudeCodeRouteHookInstallOptions,
  type ClaudeCodeRouteHookInstallResult,
} from "./claude-code.js";
export {
  installCodexRouteHook,
  ensureCodexHooksFeatureFlag,
  type CodexRouteHookInstallOptions,
  type CodexRouteHookInstallResult,
} from "./codex.js";
export {
  SKILLET_ROUTE_HOOK_MARKER,
  LEGACY_CURSOR_HOOK_MARKER,
  isSkilletRouteHookCommand,
  recorderHookCommand,
} from "./shared.js";

export interface RouteHookInstallOptions {
  recorderCommand: string;
  cursorDir?: string;
  claudeDir?: string;
  codexDir?: string;
}

export interface RouteHookInstallResult {
  runtime: string;
  installed: boolean;
  configPath?: string;
  command?: string;
  error?: string;
}

export interface InstallRouteHooksResult {
  installed: string[];
  skipped: string[];
  warnings: string[];
  results: RouteHookInstallResult[];
}

export async function installRouteHook(
  runtime: string,
  opts: RouteHookInstallOptions,
): Promise<RouteHookInstallResult> {
  if (!isHookCapableRuntime(runtime)) {
    return { runtime, installed: false, error: `unsupported runtime: ${runtime}` };
  }

  try {
    if (runtime === "cursor") {
      const result = await installCursorRouteHook({
        recorderCommand: opts.recorderCommand,
        cursorDir: opts.cursorDir,
      });
      return {
        runtime,
        installed: result.installed,
        configPath: result.hooksPath,
        command: result.command,
      };
    }
    if (runtime === "claude-code") {
      const result = await installClaudeCodeRouteHook({
        recorderCommand: opts.recorderCommand,
        claudeDir: opts.claudeDir,
      });
      return {
        runtime,
        installed: result.installed,
        configPath: result.settingsPath,
        command: result.command,
      };
    }
    const result = await installCodexRouteHook({
      recorderCommand: opts.recorderCommand,
      codexDir: opts.codexDir,
    });
    return {
      runtime,
      installed: result.installed,
      configPath: result.hooksPath,
      command: result.command,
    };
  } catch (err) {
    return {
      runtime,
      installed: false,
      error: (err as Error).message,
    };
  }
}

export async function installRouteHooksForRuntimes(
  runtimes: string[],
  opts: RouteHookInstallOptions,
): Promise<InstallRouteHooksResult> {
  const installed: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];
  const results: RouteHookInstallResult[] = [];

  for (const runtime of runtimes) {
    if (!isHookCapableRuntime(runtime)) {
      skipped.push(runtime);
      continue;
    }
    const result = await installRouteHook(runtime, opts);
    results.push(result);
    if (result.installed) {
      installed.push(runtime);
    } else if (result.error) {
      warnings.push(`${runtime} /skillet hook: ${result.error}`);
    } else {
      skipped.push(runtime);
    }
  }

  return { installed, skipped, warnings, results };
}
