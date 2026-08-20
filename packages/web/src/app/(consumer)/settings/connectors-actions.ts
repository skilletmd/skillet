'use server'

import { cookies } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { readSessionCookie } from '@/lib/session-cookie'
import { enableMcpLink, disableMcpLink, regenerateMcpLink } from '@/lib/mcp-link'

export interface McpLinkActionResult {
  ok: boolean
  /** The live link URL on an enable/regenerate success, so the panel can swap it in. */
  url?: string
  error?: string
}

const UNCONFIGURED = 'MCP links aren’t enabled on this registry.'

/**
 * Turn MCP on. The registry mints the link on first enable and returns the live
 * one on repeat calls — either way the page reflects the enabled state after.
 */
export async function enableMcpLinkAction(): Promise<McpLinkActionResult> {
  const sessionToken = readSessionCookie(await cookies())
  if (!sessionToken) return { ok: false, error: 'Sign in first.' }

  const res = await enableMcpLink(sessionToken)
  if (!res.ok) {
    return { ok: false, error: res.error === 'unconfigured' ? UNCONFIGURED : 'Could not enable. Try again.' }
  }
  if (!res.enabled) return { ok: false, error: 'Could not enable. Try again.' }
  revalidatePath('/settings')
  return { ok: true, url: res.link.url }
}

/**
 * Turn MCP off. The registry revokes the active link and does not re-mint —
 * clients still pointed at it disconnect the moment this returns.
 */
export async function disableMcpLinkAction(): Promise<McpLinkActionResult> {
  const sessionToken = readSessionCookie(await cookies())
  if (!sessionToken) return { ok: false, error: 'Sign in first.' }

  const res = await disableMcpLink(sessionToken)
  if (!res.ok) {
    return { ok: false, error: 'Could not disable. Try again.' }
  }
  revalidatePath('/settings')
  return { ok: true }
}

/**
 * Regenerate the caller's personal MCP link. The registry revokes the active
 * link and mints its replacement in one transaction — clients still pointed at
 * the old URL disconnect the moment this returns.
 */
export async function regenerateMcpLinkAction(): Promise<McpLinkActionResult> {
  const sessionToken = readSessionCookie(await cookies())
  if (!sessionToken) return { ok: false, error: 'Sign in first.' }

  const res = await regenerateMcpLink(sessionToken)
  if (!res.ok) {
    return { ok: false, error: res.error === 'unconfigured' ? UNCONFIGURED : 'Could not regenerate. Try again.' }
  }
  if (!res.enabled) return { ok: false, error: 'Could not regenerate. Try again.' }
  revalidatePath('/settings')
  return { ok: true, url: res.link.url }
}
