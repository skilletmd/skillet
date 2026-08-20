import { Notice } from '@/components/ui/notice'
import { ChevronRight, Plug } from '@/components/ui/icons'
import { AgentGlyph } from '@/components/agent-glyph'
import { runtimeLabel } from '@/lib/runtime-labels'
import { timeAgo } from '@/lib/feed-format'
import { McpConnectorDetails } from '@/components/settings/mcp-connector-details'
import { McpExpandable, MCP_SECTION_ID } from '@/components/settings/mcp-expandable'
import type { McpLinkResult } from '@/lib/mcp-link'

// MCP_SECTION_ID re-exported from its client home so existing importers keep working.
export { MCP_SECTION_ID }

/** The shared row shell — same anatomy as a device row (icon box, title, meta,
 * right-side slot) so the MCP row reads as one of the list. */
function RowShell({ meta, action }: { meta: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-5 py-4">
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-(--line) text-(--ink-2)"
        aria-label="MCP link"
      >
        <Plug className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <span className="truncate text-sm font-semibold text-(--ink)">MCP</span>
        {meta}
      </div>
      {action}
    </div>
  )
}

/**
 * The MCP link as a row in the Connections list — a sibling of the device rows,
 * not a device (no kits, no sync, no update consent). Collapsed to one line;
 * expanding reveals the link panel and per-client setup steps, so the
 * instructions never sit permanently on the page.
 *
 * Render by registry state:
 *   unconfigured → nothing (this registry doesn't offer MCP links)
 *   unauthorized / unavailable → the row with a notice, so a user who enabled
 *     MCP never watches it silently vanish. A stale registry cookie
 *     (unauthorized) self-heals via the /api/registry proxy on the same visit,
 *     so "refresh to try again" is literally the fix.
 *   disabled → the row with Enable
 *   enabled → expandable: link panel, setup steps, scope note
 */
export function McpConnectorRow({ link }: { link: McpLinkResult }) {
  if (!link.ok && link.error === 'unconfigured') return null

  if (!link.ok) {
    return (
      <li id={MCP_SECTION_ID} className="scroll-mt-8 px-4 py-3">
        <Notice tone="danger">Couldn’t load your MCP link. Refresh to try again.</Notice>
      </li>
    )
  }

  // Not enabled → no row. MCP isn't a live connection until it's on; enabling
  // it lives in the Add Connection hub, so the list only shows real connections.
  if (!link.enabled) return null

  const { url, last_used_at, clients } = link.link
  return (
    <li className="overflow-hidden">
      <McpExpandable
        id={MCP_SECTION_ID}
        className="group scroll-mt-8"
        summary={
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <RowShell
            meta={
              /* Same grammar as a device row: glyphs, then activity. Glyphs
                 are usage-attributed (initialize handshakes) — an unused link
                 shows no client icons, only "Not used yet". */
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {clients.map(({ client }) => (
                  <span
                    key={client}
                    title={runtimeLabel(client)}
                    aria-label={runtimeLabel(client)}
                    className="flex h-5 w-5 items-center justify-center rounded-md text-(--ink-2)"
                  >
                    <AgentGlyph runtime={client} className="h-3.5 w-3.5" />
                  </span>
                ))}
                <span className={`text-xs text-(--ink-3) ${clients.length > 0 ? 'ml-1.5' : ''}`}>
                  {last_used_at == null
                    ? 'Not used yet'
                    : `Last used ${timeAgo(last_used_at, { suffix: true })}`}
                </span>
              </div>
            }
            action={
              /* Right slot = scope, matching the device rows' "All N kits":
                 the link serves the same kit manifest devices sync from
                 (no per-kit filter yet). */
              <span className="flex shrink-0 items-center gap-2 text-(--ink-2)">
                <span className="hidden text-xs text-(--ink-3) sm:inline">All kits</span>
                <span className="inline-flex transition-transform duration-200 group-open:rotate-90">
                  <ChevronRight className="h-4 w-4" />
                </span>
              </span>
            }
            />
          </summary>
        }
      >
        <div className="border-t border-(--line) px-4 py-4">
          <McpConnectorDetails url={url} manage />
        </div>
      </McpExpandable>
    </li>
  )
}
