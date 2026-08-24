import { REGISTRY_API } from '@/lib/registry-prefix'
import { registryFetchOriginOrDefault } from '@/lib/registry-origin'

/**
 * Summon one kit rather than a whole person.
 *
 * `/{handle}/summon` is the right unit when you want everything someone runs.
 * A kit is the narrower one: a named, curated set with a subject. "Use shadcn's
 * UI kit on this component" is a more precise instruction than "use shadcn",
 * and on a kit page it is the only borrow action that matches what the visitor
 * is looking at.
 *
 * There is no summon at the single-skill level and there should not be. Summon
 * means "pick the right one from a set"; one skill is not a set, and the skill
 * page's Markdown twin already returns SKILL.md inline. A third URL for the
 * same bytes would only be a second way to say the same thing.
 *
 * Composed here rather than in the registry because the registry already serves
 * everything needed: `/kits/by-handle/:owner/:slug` returns member skills with
 * their descriptions and current hashes. This reshapes that into the same
 * envelope `/authors/:handle/summon` returns, so an agent that has learned one
 * summon response can read either without being told they differ.
 */
type KitMember = {
  skill_id?: string
  description?: string | null
  current_hash?: string | null
  pinned_hash?: string | null
}

type KitPayload = {
  owner?: string
  slug?: string
  name?: string | null
  description?: string | null
  visibility?: string
  skills?: KitMember[]
}

/** `skill_id` arrives as `author:slug`. A slug may not contain a colon, so the
 *  first one is the boundary. */
function splitSkillId(id: string): { author: string; slug: string } | null {
  const at = id.indexOf(':')
  if (at <= 0 || at === id.length - 1) return null
  return { author: id.slice(0, at), slug: id.slice(at + 1) }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ author: string; slug: string }> },
): Promise<Response> {
  const { author, slug } = await params
  const origin = registryFetchOriginOrDefault()

  let res: Response
  try {
    res = await fetch(
      `${origin}${REGISTRY_API}/kits/by-handle/${encodeURIComponent(author)}/${encodeURIComponent(slug)}`,
      { next: { revalidate: 60 } },
    )
  } catch {
    return Response.json({ error: 'registry_unavailable' }, { status: 503 })
  }

  if (res.status === 404) {
    return Response.json({ error: 'not_found', kit: `@${author}/${slug}` }, { status: 404 })
  }
  if (!res.ok) {
    return Response.json({ error: 'registry_unavailable' }, { status: 502 })
  }

  const kit = (await res.json()) as KitPayload

  // A private kit must not become summonable just because this path composes
  // its own response instead of forwarding the registry's.
  if (kit.visibility && kit.visibility !== 'public') {
    return Response.json({ error: 'not_found', kit: `@${author}/${slug}` }, { status: 404 })
  }

  const skills = (kit.skills ?? []).flatMap((m) => {
    const id = typeof m.skill_id === 'string' ? splitSkillId(m.skill_id) : null
    if (!id) return []
    return [
      {
        ref: `@${id.author}/${id.slug}`,
        slug: id.slug,
        description: m.description ?? '',
        // A pinned member is pinned on purpose: summoning it should get the
        // version the curator chose, not whatever the author shipped since.
        latest_hash: m.pinned_hash ?? m.current_hash ?? null,
        // Mirrors the author-summon contract: `via` is the curator when the
        // skill is someone else's work, and `ref` always names the true author.
        via: id.author === author ? null : author,
      },
    ]
  })

  return Response.json(
    {
      handle: author,
      kit: `@${author}/${slug}`,
      name: kit.name ?? slug,
      description: kit.description ?? '',
      skills,
    },
    {
      status: 200,
      headers: { 'cache-control': 'public, max-age=60, stale-while-revalidate=300' },
    },
  )
}

export const HEAD = GET
