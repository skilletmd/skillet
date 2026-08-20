import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { McpConnectorRow } from './mcp-connector-section'
import type { McpLinkResult } from '@/lib/mcp-link'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))
vi.mock('@/app/(consumer)/settings/connectors-actions', () => ({
  enableMcpLinkAction: vi.fn(),
  disableMcpLinkAction: vi.fn(),
  regenerateMcpLinkAction: vi.fn(),
}))

const enabledLink = (
  last_used_at: number | null,
  clients: Array<{ client: string; last_used_at: number }> = [],
): McpLinkResult => ({
  ok: true,
  enabled: true,
  link: {
    url: 'https://registry.test/api/v1/mcp/skillet_m_abc',
    token: 'skillet_m_abc',
    created_at: 1_751_500_000,
    last_used_at,
    clients,
  },
})

// Rows are `<li>`s — render them in a list like the Connections panel does.
const renderRow = (link: McpLinkResult) => render(<ul>{<McpConnectorRow link={link} />}</ul>)

describe('McpConnectorRow', () => {
  it('renders nothing when the registry offers no MCP (unconfigured)', () => {
    const { container } = renderRow({ ok: false, error: 'unconfigured' })
    expect(container.querySelector('li')).toBeNull()
  })

  it('keeps the row visible with a notice when the registry session lapsed (unauthorized)', () => {
    renderRow({ ok: false, error: 'unauthorized' })
    expect(screen.getByText(/Couldn’t load your MCP link/)).toBeInTheDocument()
  })

  it('keeps the row visible with a notice when the registry is unavailable', () => {
    renderRow({ ok: false, error: 'unavailable' })
    expect(screen.getByText(/Couldn’t load your MCP link/)).toBeInTheDocument()
  })

  it('renders nothing when MCP is not enabled (enabling lives in the Add Connection hub)', () => {
    const { container } = renderRow({ ok: true, enabled: false })
    expect(container.querySelector('li')).toBeNull()
  })

  it('enabled state shows the link and the client tabs; glyphs only from real usage', () => {
    renderRow(enabledLink(null))
    // The link renders in the click-to-copy CopyBox (no input field).
    expect(
      screen.getByText('https://registry.test/api/v1/mcp/skillet_m_abc'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy your MCP link' })).toBeInTheDocument()
    // Never-used link: no client glyphs in the row (the setup pills inside the
    // expanded details still name the clients — those are instructions).
    expect(screen.queryByLabelText('ChatGPT')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Claude.ai')).not.toBeInTheDocument()
    expect(screen.getByText('ChatGPT')).toBeInTheDocument()
    expect(screen.getByText('Claude.ai')).toBeInTheDocument()
  })

  it('a used link shows glyphs for exactly the clients that connected', () => {
    const now = Math.floor(Date.now() / 1000)
    renderRow(enabledLink(now, [{ client: 'chatgpt', last_used_at: now }]))
    expect(screen.getByLabelText('ChatGPT')).toBeInTheDocument()
    expect(screen.queryByLabelText('Claude.ai')).not.toBeInTheDocument()
  })

  it('never-used link reads "Not used yet" — no timestamp math on null', () => {
    renderRow(enabledLink(null))
    expect(screen.getByText('Not used yet')).toBeInTheDocument()
    expect(screen.queryByText(/Last used/)).not.toBeInTheDocument()
  })

  it('a used link reads "Last used Xh ago" from unix seconds', () => {
    const threeHoursAgo = Math.floor(Date.now() / 1000) - 3 * 3600
    renderRow(enabledLink(threeHoursAgo))
    expect(screen.getByText('Last used 3h ago')).toBeInTheDocument()
  })

  it('a registry that omits the field entirely still reads "Not used yet"', () => {
    const link = enabledLink(null)
    // Simulate a pre-upgrade registry body where the key is absent.
    delete (link as { link: { last_used_at?: number | null } }).link.last_used_at
    renderRow(link)
    expect(screen.getByText('Not used yet')).toBeInTheDocument()
  })
})
