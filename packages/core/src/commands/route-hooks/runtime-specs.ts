export const HOOK_CAPABLE_RUNTIMES = ["cursor", "claude-code", "codex"] as const;

export type HookCapableRuntime = (typeof HOOK_CAPABLE_RUNTIMES)[number];

export function isHookCapableRuntime(name: string): name is HookCapableRuntime {
  return (HOOK_CAPABLE_RUNTIMES as readonly string[]).includes(name);
}

/**
 * Runtimes whose prompt hook can ADD to the prompt, not just block it.
 *
 * Claude Code and Codex both honor `hookSpecificOutput.additionalContext` on
 * `UserPromptSubmit`. Cursor's `beforeSubmitPrompt` can only allow or block: its
 * output schema has no additional-context field, so on Cursor the hook stays a
 * detector and the agent gets the same candidates from the first verb call.
 *
 * Hook-capable is not the same as injection-capable. Keep them separate rather
 * than assuming every runtime with a hook can be pre-loaded.
 */
export const CONTEXT_INJECTING_RUNTIMES = ["claude-code", "codex"] as const;

export function canInjectContext(name: string): boolean {
  return (CONTEXT_INJECTING_RUNTIMES as readonly string[]).includes(name);
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
