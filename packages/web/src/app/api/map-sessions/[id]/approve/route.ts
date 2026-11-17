import type { NextRequest } from 'next/server'
import {
  asSignedIn,
  bodyOf,
  clearBinding,
  heldBinding,
  isMapSessionId,
  isOwnRequest,
  json,
  keepSession,
  notFound,
  registry,
} from '../../map-session-guard'

// POST /api/map-sessions/:id/approve: the signed-in person confirms Save on the
// computer the session names. It needs this origin, the request token, the
// binding cookie and a username; the registry answers success only and mints
// the code for the waiting terminal, never for this page. Only a successful
// approve spends the binding: a refusal for a missing username leaves it in
// place, so the retry after the username step goes through.

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!isMapSessionId(id)) return notFound()
  if (!isOwnRequest(req)) return json({ error: 'cross_origin' }, 403)

  const held = heldBinding(req)
  if (!held) return json({ error: 'binding_required' }, 403)

  const { upstream, refreshed } = await asSignedIn(req, (session) =>
    registry(`${id}/approve`, { method: 'POST', body: { binding: held.binding }, session }),
  )
  if (!upstream) return json({ error: 'registry_unreachable' }, 502)

  let res
  let spent = false
  switch (upstream.status) {
    case 200:
      res = json({ ok: true })
      spent = true
      break
    case 401:
      res = json({ error: 'sign_in_required' }, 401)
      break
    case 409: {
      // No username yet keeps the binding for the retry; an approve that already
      // happened spent it.
      const username = (await bodyOf(upstream)).error === 'username_required'
      res = json({ error: username ? 'username_required' : 'already_approved' }, 409)
      spent = !username
      break
    }
    case 410:
      res = json({ error: 'expired' }, 410)
      spent = true
      break
    case 403:
      // binding_required / binding_invalid: not the binding this session took.
      res = json({ error: 'binding_invalid' }, 403)
      spent = true
      break
    case 404:
      res = notFound()
      spent = true
      break
    default:
      res = json({ error: 'registry_unreachable' }, 502)
  }
  if (spent) clearBinding(res, id)
  keepSession(res, refreshed)
  return res
}
