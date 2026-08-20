export const HOOK_CAPABLE_RUNTIMES = ["cursor", "claude-code", "codex"] as const;

export type HookCapableRuntime = (typeof HOOK_CAPABLE_RUNTIMES)[number];

export function isHookCapableRuntime(name: string): name is HookCapableRuntime {
  return (HOOK_CAPABLE_RUNTIMES as readonly string[]).includes(name);
}

/** Map sync adapter names to hook installer runtime keys (deduped). */
export function hookRuntimesFromDetected(detected: string[]): HookCapableRuntime[] {
  const out = new Set<HookCapableRuntime>();
  for (const name of detected) {
    if (name === "cursor") out.add("cursor");
    else if (name === "claude-code") out.add("claude-code");
    else if (name === "codex" || name === "codex-project") out.add("codex");
  }
  return [...out];
}
