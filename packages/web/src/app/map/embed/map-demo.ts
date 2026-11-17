import type { JobId } from '@skillet/protocol/jobs'
import type { KitMapEntry, KitMapScan } from '@skillet/protocol/kit-map'

// The embed's `?demo` (./map-embed.tsx): a sample scan and a Save state to look
// at, for the visual checks. Loaded only off production, and only for `?demo`.

/** `?demo&state=…`: a Save state to look at, for the visual checks. */
export function demoSave(state: string | null) {
  switch (state) {
    case 'opened':
      return { type: 'pressed', opened: true } as const
    case 'blocked':
      return { type: 'pressed', opened: false } as const
    case 'checking':
      return { type: 'checking' } as const
    case 'confirm':
      return { type: 'status', state: 'confirm', handle: 'sample' } as const
    case 'saving':
    case 'applying':
    case 'done':
    case 'failed':
    case 'expired':
    case 'ended':
      return { type: 'status', state } as const
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// The ?demo scan: one of every mark, on made-up skills
// ---------------------------------------------------------------------------

let demoSeq = 0
function demo(name: string, job: JobId | null, over: Partial<KitMapEntry> = {}): KitMapEntry {
  demoSeq += 1
  return {
    key: `sha256:${demoSeq.toString(16).padStart(64, '0')}`,
    name,
    description: '',
    source: 'local',
    tools: [{ tool: 'claude-code', copies: 1 }],
    job,
    usage: { state: 'used', reason: null },
    ...over,
  }
}

type Over = Partial<KitMapEntry>
const unused: Over = { usage: { state: 'unused', reason: 'no-recent-run' } }
const viaCodex: Over = { tools: [{ tool: 'codex', copies: 1 }], usage: { state: 'unknown', reason: 'short-history' } }
const viaCursor: Over = { tools: [{ tool: 'cursor', copies: 1 }], usage: { state: 'unknown', reason: 'no-history' } }
const pluginOf = (name: string, on: boolean | null = true): Over => ({ source: 'plugin', from: { kind: 'plugin', name, on } })
const added = (ref: string, name: string): Over => ({ source: 'skillet-added', skillet: { ref, name } })

export const DEMO_SCAN: KitMapScan = {
  entries: [
    demo('Plain Prose', 'writing.editing'),
    demo('Copy Editor', 'writing.editing', unused),
    demo('Thread Writer', 'writing.short-posts'),
    demo('Readme Writer', 'writing.docs', unused),
    demo('Write Landing', 'marketing.landing-pages', added('@openclaudia/write-landing', 'Write Landing')),
    demo('Launch Notes', 'marketing.launches', { source: 'skillet-own', skillet: { ref: null, name: 'Launch Notes' } }),
    demo('Lead Lists', 'sales.prospecting', unused),
    demo('Interface Polish', 'design.interfaces'),
    demo('Design Review', 'design.design-reviews', pluginOf('compound-engineering')),
    demo('Interface Guidelines', 'design.design-reviews', pluginOf('ui-kit')),
    demo('Type Scale', 'design.visual-system', { noMerge: { reason: 'extra-files' } }),
    demo('Spring Motion', 'design.motion', { ...pluginOf('motion-pack', false), ...unused }),
    demo('Code Review', 'development.code-review', pluginOf('compound-engineering')),
    demo('Requesting Code Review', 'development.code-review', pluginOf('superpowers')),
    demo('TDD', 'development.tests', added('@mattpocock/tdd', 'TDD')),
    demo('Systematic Debugging', 'development.debugging', { ...pluginOf('superpowers'), ...unused }),
    demo('PR Writer', 'development.pull-requests'),
    demo('Commit Helper', 'development.pull-requests', { tools: [{ tool: 'claude-code', copies: 2 }] }),
    demo('Plan', 'development.specs', pluginOf('compound-engineering')),
    demo('Workers', 'development.platforms'),
    demo('Wrangler', 'development.platforms'),
    demo('Durable Objects', 'development.platforms', unused),
    demo('Deploy Notes', 'development.platforms', { noBackup: { reason: 'secret', file: '.env.local' } }),
    demo('Next.js on Workers', 'development.platforms', viaCodex),
    demo('Deep Research', 'research.web-research', viaCodex),
    demo('Data Viz', 'research.data-analysis'),
    demo('Office Hours', 'business.strategy', unused),
    demo('Meeting Notes', 'business.meetings', viaCursor),
    demo('PDF Tools', 'business.docs-and-pdfs', pluginOf('office-docs')),
    demo('Clip Maker', 'media.video', unused),
    demo('Agent Browser', 'tools.browser', added('@vercel/agent-browser', 'Agent Browser')),
    demo('Chrome Driver', 'tools.browser', unused),
    demo('Morning Brief', null),
    demo('Notes Sync', null, unused),
  ],
  looked: [
    { tool: 'claude-code', history: 'read' },
    { tool: 'codex', history: 'short' },
    { tool: 'cursor', history: 'none' },
  ],
  unchecked: [
    { reason: 'project-plugin', tools: ['claude-code'], plugin: 'review-tools@team-marketplace' },
    { reason: 'broken-link', tools: ['codex'] },
  ],
}
