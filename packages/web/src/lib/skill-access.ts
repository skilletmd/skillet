import { cookies } from 'next/headers'
import { listMyOrgs } from '@/lib/orgs-server'
import { readSessionCookie } from '@/lib/session-cookie'
import { REGISTRY_API } from '@/lib/registry-prefix'

/**
 * Server-side capability checks for a skill, shared by the public page's owner
 * controls and the /edit route guard so both agree on who may manage vs. propose.
 * Keeping them in one module means the edit page can't drift from the affordances
 * the public page shows.
 */

/**
 * Mirrors the registry's canManageSkill so the "Manage skill" affordance matches
 * what the edit/publish endpoints actually allow: the personal owner
 * (handle === author) or an owner/admin of the org that owns the skill (author is
 * the org slug). Plain org members and strangers fall through to propose. Any
 * registry hiccup falls back to false — never grant manage on uncertainty.
 */
export async function viewerCanManageSkill(handle: string, author: string): Promise<boolean> {
  if (handle === author) return true
  const result = await listMyOrgs()
  if (result.kind !== 'ok') return false
  return result.orgs.some((o) => o.slug === author && (o.role === 'owner' || o.role === 'admin'))
}

/**
 * Server-side eligibility check for the propose affordance. The proposals list
 * endpoint enforces canProposeToSkill (200 = may propose, 403 = may not), so we
 * reuse it as the single source of truth rather than re-deriving the rule here.
 * Runs server-to-server, so a denied viewer never sees a 403 in the console. Any
 * hiccup → false (deny).
 */
export async function viewerCanPropose(author: string, slug: string): Promise<boolean> {
  const token = readSessionCookie(await cookies())
  if (!token) return false
  const base =
    process.env.REGISTRY_URL ?? process.env.NEXT_PUBLIC_REGISTRY_URL ?? 'http://127.0.0.1:3481'
  const url = `${base}${REGISTRY_API}/skills/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/proposals`
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    return res.ok
  } catch {
    return false
  }
}
