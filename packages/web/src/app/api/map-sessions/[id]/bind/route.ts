import type { NextRequest } from 'next/server'
import {
  bodyOf,
  isMapSessionId,
  isOwnRequest,
  isSecret,
  json,
  notFound,
  readCounts,
  registry,
  setBinding,
} from '../../map-session-guard'

// POST /api/map-sessions/:id/bind: the save tab trades the one-time proof its
// opener handed it for the binding, before any sign-in. The binding goes into a
// Strict, httpOnly cookie scoped to this session and never into the response,
// so no page script holds it. The counts ride along in that cookie, so the
// confirm can say what Save will do after the Google round trip cut the opener.

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!isMapSessionId(id)) return notFound()
  if (!isOwnRequest(req)) return json({ error: 'cross_origin' }, 403)

  const input = (await req.json().catch(() => null)) as { proof?: unknown; counts?: unknown } | null
  const proof = input?.proof
  const counts = readCounts(input?.counts)
  if (!isSecret(proof) || !counts) return json({ error: 'invalid_request' }, 400)

  const upstream = await registry(`${id}/bind`, { method: 'POST', body: { proof } })
  if (!upstream) return json({ error: 'registry_unreachable' }, 502)
  if (upstream.ok) {
    const body = await bodyOf(upstream)
    if (!isSecret(body.binding)) return json({ error: 'registry_unreachable' }, 502)
    const res = json({ ok: true })
    setBinding(res, id, body.binding, counts, body.expires_at)
    return res
  }
  switch (upstream.status) {
    case 403:
      return json({ error: 'proof_invalid' }, 403)
    case 404:
      return notFound()
    case 410:
      return json({ error: 'expired' }, 410)
    case 400:
      return json({ error: 'invalid_request' }, 400)
    default:
      return json({ error: 'registry_unreachable' }, 502)
  }
}
