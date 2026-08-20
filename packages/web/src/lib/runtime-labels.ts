/**
 * Canonical display labels for agent runtimes. One source of truth so the same
 * runtime never shows as "Claude Code" in one view and "claude-code" in another.
 */
export const RUNTIME_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex',
  // The `windsurf` key is a frozen runtime id; the product is Devin Desktop
  // after Cognition's June 2026 rebrand of the Windsurf editor.
  windsurf: 'Devin Desktop',
  hermes: 'Hermes',
  openclaw: 'OpenClaw',
  // opencode reads the shared ~/.agents/skills baseline and IS auto-detected
  // (via ~/.config/opencode), so it earns a verified chip like the others.
  opencode: 'OpenCode',
}

/**
 * Ecosystem agents a user can show on their profile but that Skillet does NOT
 * auto-detect (so they never get a verified check). Ordered for the profile
 * "Add agent" dropdown. Kept separate from RUNTIME_LABELS so the detectable set
 * (the chips) stays distinct, while labels resolve consistently everywhere.
 */
export const EXTRA_AGENTS: string[] = [
  'gemini',
  'copilot',
  'amp',
  'kimi',
  'antigravity',
  'zed',
  'roo',
  'devin',
  'chatgpt',
  'claude-ai',
]
const EXTRA_AGENT_LABELS: Record<string, string> = {
  gemini: 'Gemini',
  copilot: 'GitHub Copilot',
  amp: 'Amp',
  kimi: 'Kimi',
  antigravity: 'Antigravity',
  zed: 'Zed',
  roo: 'Roo Code',
  devin: 'Devin',
  chatgpt: 'ChatGPT',
  'claude-ai': 'Claude.ai',
}

/** Label for a runtime, falling back to a titlecased version of the raw name. */
export function runtimeLabel(name: string): string {
  return (
    RUNTIME_LABELS[name] ??
    EXTRA_AGENT_LABELS[name] ??
    name.replace(/(^|[-\s])(\w)/g, (_, sep, c) => sep + c.toUpperCase())
  )
}
