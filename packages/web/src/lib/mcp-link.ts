import 'server-only'

import { REGISTRY_API } from './registry-prefix'
import { logRegistryDegrade } from './registry-errors'
import { registryFetchOriginOrDefault, registryPublicOrigin } from './registry-origin'

function registryFetchBaseUrl(): string {
  return registryFetchOriginOrDefault()
}

/** Compose the user-facing MCP URL. Server fetches use loopback; the printed
 *  URL must be the public origin ChatGPT/Claude.ai can reach. */
function publicMcpLinkUrl(token: string, registryUrl: string): string {
  const publicBase = registryPublicOrigin()
  if (!publicBase) return registryUrl
  return `${publicBase}${REGISTRY_API}/mcp/${token}`
}

export interface McpLink {
  url: string
  token: string
  created_at: number
  /** Unix seconds of the last authenticated serve-side request; null until first use. */
  last_used_at: number | null
  /** Clients that have actually connected (from initialize handshakes), most recent first. */
  clients: Array<{ client: string; last_used_at: number }>
}

export type McpLinkResult =
  /** MCP is off — no link exists until the user enables it. */
  | { ok: true; enabled: false }
  /** MCP is on — the live link. */
  | { ok: true; enabled: true; link: McpLink }
  /** `unconfigured` = the registry offers no MCP links (503 mcp_key_unconfigured — hide the surface);
   *  `unauthorized` = the caller's registry session is missing/expired (401);
   *  `unavailable` = any other failure (network, 5xx, undecryptable key) — the link may still exist. */
  | { ok: false; error: 'unconfigured' | 'unauthorized' | 'unavailable' }

interface EnabledBody {
  enabled?: boolean
  url?: string
  token?: string
  created_at?: number
  last_used_at?: number | null
  clients?: Array<{ client?: unknown; last_used_at?: unknown }>
}

async function callMcpLink(
  sessionToken: string,
  opts: { method: 'GET' | 'POST'; path: string },
): Promise<McpLinkResult> {
  try {
    const res = await fetch(`${registryFetchBaseUrl()}${opts.path}`, {
      method: opts.method,
      headers: { authorization: `Bearer ${sessionToken}`, accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) {
      if (res.status === 503) {
        // Only "no key configured" means MCP isn't offered here. A rotated key
        // (mcp_key_undecryptable) still has a live link behind it — surface as
        // unavailable so settings shows its notice instead of hiding the section.
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        if (body.error === 'mcp_key_unconfigured') return { ok: false, error: 'unconfigured' }
        logRegistryDegrade(`mcp link responded 503 ${body.error ?? '(no error body)'}`)
        return { ok: false, error: 'unavailable' }
      }
      if (res.status === 401) return { ok: false, error: 'unauthorized' }
      if (res.status >= 500) logRegistryDegrade(`mcp link responded ${res.status}`)
      return { ok: false, error: 'unavailable' }
    }
    const body = (await res.json()) as EnabledBody
    if (body.enabled === false) return { ok: true, enabled: false }
    return {
      ok: true,
      enabled: true,
      link: {
        url: publicMcpLinkUrl(body.token!, body.url!),
        token: body.token!,
        created_at: body.created_at!,
        // A registry that predates this field yields null, not undefined.
        last_used_at: body.last_used_at ?? null,
        // Same back-compat rule: older registries send no clients → empty.
        clients: Array.isArray(body.clients)
          ? body.clients.flatMap((c) =>
              typeof c?.client === 'string' && typeof c?.last_used_at === 'number'
                ? [{ client: c.client, last_used_at: c.last_used_at }]
                : [],
            )
          : [],
      },
    }
  } catch (cause) {
    logRegistryDegrade('mcp link fetch failed', cause)
    return { ok: false, error: 'unavailable' }
  }
}

/** The user's personal MCP link. Read-only: off until the user enables it (R6). */
export async function fetchMcpLink(sessionToken: string): Promise<McpLinkResult> {
  return callMcpLink(sessionToken, { method: 'GET', path: `${REGISTRY_API}/mcp/link` })
}

/** Turn MCP on. Idempotent — mints on first enable, returns the live link after. */
export async function enableMcpLink(sessionToken: string): Promise<McpLinkResult> {
  return callMcpLink(sessionToken, { method: 'POST', path: `${REGISTRY_API}/mcp/link/enable` })
}

/** Turn MCP off. Revokes the active link and disconnects any connected client. */
export async function disableMcpLink(sessionToken: string): Promise<McpLinkResult> {
  return callMcpLink(sessionToken, { method: 'POST', path: `${REGISTRY_API}/mcp/link/disable` })
}

/** Revoke the active link and mint a replacement — old link dies immediately. */
export async function regenerateMcpLink(sessionToken: string): Promise<McpLinkResult> {
  return callMcpLink(sessionToken, { method: 'POST', path: `${REGISTRY_API}/mcp/link/regenerate` })
}
