// Single source of truth for where Skillet can deliver skills and what to
// promise on each surface. Two independent axes:
//
//   mechanism  — HOW a skill is delivered (drives the install path)
//   persistence — WHETHER it stays + auto-updates (drives the UI copy)
//
// `channel` is who performs the install (terminal CLI, desktop app, plugin,
// or CI). Chat surfaces have no shell, so the desktop app is their carrier.
//
// The status and docs pages render from this table, so the per-surface
// expectation can never drift from the truth.

export type Persistence = 'persistent' | 'on-demand' | 'sandboxed'
export type Channel = 'cli' | 'desktop' | 'plugin' | 'ci'
export type Mechanism =
  | 'dir' // materialize into a local skills directory
  | 'project-rules' // project-scoped rules files (.cursor/rules, …)
  | 'mcp' // reached live over an MCP server
  | 'native-api' // /v1/skills programmatic upload — Responses API / Codex execution env (dev/CI), NOT a ChatGPT chat surface
  | 'export' // frozen export / custom GPT / project upload
  | 'paste' // project-knowledge paste/upload
  | 'env' // environment injection (CI / cloud)
export type SurfaceStatus = 'operational' | 'in_progress'

export interface Surface {
  name: string
  channel: Channel
  /** Delivery mechanisms in priority order; the install flow picks the first the surface supports. */
  mechanism: Mechanism[]
  persistence: Persistence
  status: SurfaceStatus
  /** Concrete path / endpoint detail. */
  notes: string
  /** Set when the working mechanism depends on the account tier (e.g. ChatGPT). */
  tiered?: boolean
}

/** What each persistence class actually promises the user. The honesty layer. */
export const PERSISTENCE_COPY: Record<Persistence, { label: string; expectation: string }> = {
  persistent: {
    label: 'Always synced',
    expectation: 'Installs locally and stays current with background sync.',
  },
  'on-demand': {
    label: 'Loaded on demand',
    expectation: 'Pulled live when the agent needs it. Not stored or auto-updated.',
  },
  sandboxed: {
    label: 'Sandboxed',
    expectation: 'Loaded through a plugin/MCP. No local install on this surface.',
  },
}

/** How one mechanism connects, named as the Skillet solution the user reaches
 *  for — not the file-system detail. `dir` resolves to the client that does the
 *  syncing (the CLI, or the desktop app for chat surfaces). */
function deliveryFor(surface: Surface, mechanism: Mechanism): string {
  switch (mechanism) {
    case 'dir':
      return surface.channel === 'desktop' ? 'Desktop' : 'CLI'
    case 'project-rules':
      return 'CLI'
    case 'env':
      return 'Env'
    case 'mcp':
      return 'MCP'
    case 'export':
      return 'Export'
    case 'paste':
      return 'Paste'
    case 'native-api':
      return 'Skills API'
  }
}

/** The Skillet solution(s) that deliver skills to a surface, in user terms —
 *  CLI, Desktop, MCP, Paste, Export, Env. This is what the runtimes page shows
 *  per row instead of the channel + mechanism jargon; the exact path lives in
 *  the row's note. Deduped, in mechanism-priority order. */
export function deliveryBadges(surface: Surface): string[] {
  const out: string[] = []
  for (const mechanism of surface.mechanism) {
    const label = deliveryFor(surface, mechanism)
    if (!out.includes(label)) out.push(label)
  }
  // Export and Paste are the same user action (upload a bundle) on a surface that
  // offers both (e.g. Claude.ai); keep the plainer "Paste".
  return out.includes('Paste') ? out.filter((l) => l !== 'Export') : out
}

export const SURFACES: Surface[] = [
  {
    name: 'Claude Code',
    channel: 'cli',
    mechanism: ['dir'],
    persistence: 'persistent',
    status: 'operational',
    notes: 'Reads ~/.claude/skills/',
  },
  {
    name: 'Codex',
    channel: 'cli',
    mechanism: ['dir'],
    persistence: 'persistent',
    status: 'operational',
    notes: 'Reads ~/.agents/skills/',
  },
  {
    name: 'OpenClaw',
    channel: 'cli',
    mechanism: ['dir'],
    persistence: 'persistent',
    status: 'operational',
    notes: 'Reads ~/.openclaw/skills/',
  },
  {
    name: 'Hermes',
    channel: 'cli',
    mechanism: ['dir'],
    persistence: 'persistent',
    status: 'operational',
    notes: 'Reads ~/.hermes/skills/ and %LOCALAPPDATA%\\hermes\\skills',
  },
  {
    name: 'CI / cloud',
    channel: 'ci',
    mechanism: ['env'],
    persistence: 'persistent',
    status: 'operational',
    notes: 'SKILLET_SKILLS environment injection, current at run time',
  },
  {
    name: 'Cursor',
    channel: 'cli',
    mechanism: ['project-rules'],
    persistence: 'persistent',
    status: 'operational',
    notes: 'Project-scoped .cursor/rules/*.mdc (SKILL.md translated to .mdc)',
  },
  {
    name: 'Devin Desktop',
    channel: 'desktop',
    mechanism: ['dir'],
    persistence: 'persistent',
    status: 'operational',
    notes: 'Native SKILL.md folders in ~/.codeium/windsurf/skills (formerly Windsurf)',
  },
  {
    name: 'Devin',
    channel: 'cli',
    mechanism: ['dir'],
    persistence: 'persistent',
    status: 'operational',
    notes: 'Native SKILL.md folders in ~/.config/devin/skills',
  },
  {
    name: 'Claude Desktop',
    channel: 'cli',
    mechanism: ['mcp'],
    persistence: 'on-demand',
    status: 'operational',
    notes: 'No skills folder. Served live by skillet mcp (stdio), one config entry',
  },
  {
    name: 'Claude.ai',
    channel: 'desktop',
    mechanism: ['mcp', 'export', 'paste'],
    persistence: 'on-demand',
    status: 'operational',
    notes: 'Live over your personal MCP link (Settings → Account), or project-knowledge bundle upload.',
  },
  // ChatGPT is three different surfaces, not one. Verified against OpenAI docs
  // 2026-06-24 — re-verify before each launch; ChatGPT Skills is beta and drifts.
  {
    name: 'ChatGPT (personal)',
    channel: 'desktop',
    mechanism: ['mcp', 'export'],
    persistence: 'on-demand',
    status: 'operational',
    tiered: true,
    notes: 'Plus/Pro: dev-mode connector via your MCP link. Any tier: bundle into a Custom GPT or Project. No push API.',
  },
  {
    name: 'ChatGPT (Business/Enterprise/Edu)',
    channel: 'desktop',
    mechanism: ['export', 'mcp'],
    persistence: 'on-demand',
    status: 'operational',
    notes: 'Native Skills upload (admin, beta) or an admin-added MCP Apps connector with the same link.',
  },
  {
    name: 'Claude Cowork',
    channel: 'plugin',
    mechanism: ['mcp'],
    persistence: 'sandboxed',
    status: 'operational',
    notes: 'Add your personal MCP link (Settings → Account) as a connector. Served live, sandboxed, no local-dir write.',
  },
]

export const PERSISTENCE_ORDER: Persistence[] = ['persistent', 'on-demand', 'sandboxed']

export function surfacesByPersistence(persistence: Persistence): Surface[] {
  return SURFACES.filter((s) => s.persistence === persistence)
}

export function countByStatus(status: SurfaceStatus): number {
  return SURFACES.filter((s) => s.status === status).length
}
