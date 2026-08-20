import { mcpExtendedHelp } from "./mcp-help.js";

/** Optional extended bodies keyed by leaf command path (e.g. `mcp`). */
const LEAF_EXTENDED_HELP: Record<string, () => string> = {
  mcp: mcpExtendedHelp,
};

export function leafExtendedHelp(commandPath: string): string | null {
  const fn = LEAF_EXTENDED_HELP[commandPath];
  return fn ? fn() : null;
}
