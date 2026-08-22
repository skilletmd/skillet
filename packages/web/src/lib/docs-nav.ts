export type NavItem = { title: string; href: string }
export type NavSection = {
  title: string
  items: NavItem[]
  /** Start collapsed in the sidebar (auto-opens when a child page is active). */
  collapsed?: boolean
}

// The API reference pages are generated from the OpenAPI document
// (scripts/gen-api-docs.mjs), so a new operation reaches the sidebar without a
// hand edit here. Everything else in this file is hand-ordered.
import { API_REFERENCE_ITEMS } from './docs-nav-api.generated'

export const DOC_NAV: NavSection[] = [
  {
    title: 'Get started',
    items: [
      { title: 'What is Skillet?', href: '/docs' },
      { title: 'Skills & kits', href: '/docs/skills-and-kits' },
      { title: 'Install', href: '/docs/install' },
      { title: 'Add skills', href: '/docs/add-skills' },
    ],
  },
  {
    title: 'Using Skillet',
    items: [
      { title: 'Approve updates', href: '/docs/updates' },
      { title: 'Publish a skill', href: '/docs/publish' },
      { title: 'Teams', href: '/docs/teams' },
      { title: 'Safety', href: '/docs/safety' },
      { title: 'Privacy', href: '/docs/privacy' },
      { title: 'FAQ', href: '/docs/faq' },
    ],
  },
  {
    title: 'Reference',
    items: [
      { title: 'API', href: '/docs/api' },
      { title: 'CLI', href: '/docs/cli' },
      { title: 'MCP', href: '/docs/mcp' },
      { title: 'Scanner', href: '/docs/scanner' },
      { title: 'Skill.md', href: '/docs/skill-md' },
      { title: 'Versioning', href: '/docs/versioning' },
    ],
  },
  {
    title: 'API reference',
    collapsed: true,
    items: API_REFERENCE_ITEMS,
  },
  {
    title: 'Runtimes',
    collapsed: true,
    items: [
      { title: 'Overview', href: '/docs/runtimes' },
      { title: 'Claude Code', href: '/docs/runtimes/claude' },
      { title: 'Claude.ai', href: '/docs/runtimes/claude-ai' },
      { title: 'Claude Desktop', href: '/docs/runtimes/claude-desktop' },
      { title: 'Codex CLI', href: '/docs/runtimes/codex' },
      { title: 'Cursor', href: '/docs/runtimes/cursor' },
      { title: 'Devin Desktop', href: '/docs/runtimes/windsurf' },
      { title: 'Devin', href: '/docs/runtimes/devin' },
      { title: 'Hermes', href: '/docs/runtimes/hermes' },
      { title: 'OpenClaw', href: '/docs/runtimes/openclaw' },
      { title: 'ChatGPT', href: '/docs/runtimes/chatgpt' },
    ],
  },
]
