import { REGISTRY_API } from '@/lib/registry-prefix'
import { registryFetchOriginOrDefault } from '@/lib/registry-origin'

/**
 * The zero-install summon surface: a handle's public kit as routing candidates,
 * at a URL a person will actually paste.
 *
 * The whole borrow flow works today with nothing on disk, because an agent that
 * is told "read this URL and use their best skill for X" already has everything
 * it needs once it has descriptions and links. What it lacked was a URL worth
 * putting in front of a human: the registry serves this list at
 * `registry.skillet.md/api/v1/authors/:handle/summon`, which is correct and
 * unreadable. This is the same payload under the handle namespace, so the line
 * in the hero reads `skillet.md/@mattpocock/summon` instead.
 *
 * It proxies rather than recomposes on purpose. The registry owns what counts as
 * a candidate — authored (`via: null`) plus curated into a public kit (`via` set,
 * with `ref` naming the TRUE author) — and a second implementation here would be
 * a second answer to that question.
 *
 * `summon` is in RESERVED_SKILL_SLUGS so a skill can never be published at this
 * slug and silently shadowed by the static segment.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ author: string }> },
): Promise<Response> {
  const { author } = await params
  // BFF default: same-box loopback when no origin is configured, matching the
  // other server-to-server callers.
  const origin = registryFetchOriginOrDefault()

  let res: Response
  try {
    res = await fetch(
      `${origin}${REGISTRY_API}/authors/${encodeURIComponent(author)}/summon`,
      { next: { revalidate: 60 } },
    )
  } catch {
    return Response.json({ error: 'registry_unavailable' }, { status: 503 })
  }

  // A handle with no public kit is a real 404, not an empty success: an agent
  // that gets `{skills: []}` has no way to tell "nobody by that name" from
  // "they publish nothing", and the route skill's fallback branches on it.
  if (res.status === 404) {
    return Response.json({ error: 'not_found', handle: author }, { status: 404 })
  }
  if (!res.ok) {
    return Response.json({ error: 'registry_unavailable' }, { status: 502 })
  }

  return new Response(await res.text(), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=60, stale-while-revalidate=300',
    },
  })
}

export const HEAD = GET
