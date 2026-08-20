import { isTccParkedPath } from "../../util/tcc-access.js";

export const SKILLET_ROUTE_HOOK_MARKER = "route hook";
export const LEGACY_CURSOR_HOOK_MARKER = "route cursor-hook";

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function isSkilletRouteHookCommand(command: string): boolean {
  return (
    command.includes(SKILLET_ROUTE_HOOK_MARKER) ||
    command.includes(LEGACY_CURSOR_HOOK_MARKER)
  );
}

export function recorderHookCommand(recorderCommand: string, runtime: string): string {
  return `${shellQuote(recorderCommand)} route hook --runtime ${runtime}`;
}

/**
 * TCC gate for route-hook installers (U2/U3): is this runtime config dir
 * parked for the current invocation? A dir resolving into a macOS-protected
 * folder (~/Documents, ~/Desktop, ~/Downloads) must see no settings/hooks
 * read OR write from a run that isn't allowed to content-read it.
 *
 * EVERY route-hook installer must call this on its config dir BEFORE its
 * first filesystem access and bail out (reported as skipped via
 * `installed: false` in its own local result shape, never as an error) when
 * it returns true. New route-hook installers: apply this gate the same way —
 * the shared helper exists so the check can't drift per adapter.
 */
export function tccParkedConfigDir(dir: string): boolean {
  return isTccParkedPath(dir);
}
