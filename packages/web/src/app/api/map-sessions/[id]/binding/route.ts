import type { NextRequest } from 'next/server'
import {
  bodyOf,
  clearBinding,
  heldBinding,
  isMapSessionId,
  json,
  notFound,
  registry,
  requestToken,
  sessionToken,
  setRequestToken,
  toSession,
  type MapSaveStatus,
} from '../../map-session-guard'

// GET /api/map-sessions/:id/binding: what the save tab asks on every load.
// Whether this browser holds a live binding for the session (from its Strict
// cookie, which the page request coming back from Google never carries), the
// session's state for the binding holder or the approving account, and the
// same-origin request token bind and approve must echo. See map-session-guard.

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!isMapSessionId(id)) return notFound()

  const held = heldBinding(req)
  const { token, fresh } = requestToken(req)
  const upstream = await registry(id, {
    binding: held?.binding,
    session: sessionToken(req),
  })
  if (!upstream || upstream.status >= 500) return json({ error: 'registry_unreachable' }, 502)

  const read = upstream.ok ? toSession(await bodyOf(upstream)) : null
  // Before approval the binding holder reads the session; after it, only the
  // approving account can. A binding the registry no longer takes is cleared.
  const bound = held !== null && read !== null && !read.approver
  const status: MapSaveStatus = {
    token,
    bound,
    counts: bound ? held.counts : null,
    session: read?.session ?? null,
  }
  const res = json(status)
  if (fresh) setRequestToken(res, id, token)
  if (held && !bound) clearBinding(res, id)
  return res
}
