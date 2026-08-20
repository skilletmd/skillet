// #011 — a handle's PUBLIC kit as routing candidates for `/skillet @handle`.
//
// The union of:
//   - skills the handle AUTHORED (author_id = handle, public, not unlisted), and
//   - skills the handle CURATED into a PUBLIC kit (curation counts — a handle's
//     taste is part of the value). A curated candidate carries `via = handle`
//     and its TRUE author ref, so the router can apply the original author's
//     skill and surface it "via @handle" (attribution stays correct).
//
// Public-only, hard: a private skill never appears, and a handle's private
// (default) Saved kit contributes nothing — only kits they explicitly made
// public. Same visibility gates hardened for #463/#467; curation cannot leak a
// private skill.
import type { PrismaDb } from '../db/prisma-client.js'

export interface HandleKitCandidate {
  /** True author ref, e.g. `@thiago/blog-writer` — what the router fetches + attributes. */
  ref: string
  slug: string
  description: string | null
  latest_hash: string | null
  /** The curating handle when this skill was surfaced via their public kit; null when authored. */
  via: string | null
}

function refOf(authorId: string, slug: string): string {
  return `@${authorId}/${slug}`
}

export async function getHandleKitCandidatesPrisma(
  prisma: PrismaDb,
  handle: string,
): Promise<HandleKitCandidate[]> {
  // Authored-public skills.
  const authored = await prisma.skills.findMany({
    where: {
      author_id: handle,
      visibility: 'public',
      moderation_status: { not: 'unlisted' },
      latest_hash: { not: null },
    },
    select: { author_id: true, slug: true, description: true, latest_hash: true },
  })

  const byRef = new Map<string, HandleKitCandidate>()
  for (const s of authored) {
    const ref = refOf(s.author_id, s.slug)
    byRef.set(ref, {
      ref,
      slug: s.slug,
      description: s.description,
      latest_hash: s.latest_hash,
      via: null,
    })
  }

  // Curated: skills in the handle's PUBLIC kits (may be authored by others).
  const publicKits = await prisma.kits.findMany({
    where: { owner_id: handle, visibility: 'public' },
    select: { id: true },
  })
  if (publicKits.length > 0) {
    const kitSkills = await prisma.kit_skills.findMany({
      where: { kit_id: { in: publicKits.map((k) => k.id) } },
      select: {
        skills: {
          select: {
            author_id: true,
            slug: true,
            description: true,
            latest_hash: true,
            visibility: true,
            moderation_status: true,
          },
        },
      },
    })
    for (const ks of kitSkills) {
      const s = ks.skills
      // Public-only: a private skill in a public kit must NOT surface.
      if (
        !s ||
        s.visibility !== 'public' ||
        s.moderation_status === 'unlisted' ||
        s.latest_hash == null
      ) {
        continue
      }
      const ref = refOf(s.author_id, s.slug)
      // Authored wins over curated on dedup (via stays null when the handle
      // both wrote and curated the same skill).
      if (byRef.has(ref)) continue
      byRef.set(ref, {
        ref,
        slug: s.slug,
        description: s.description,
        latest_hash: s.latest_hash,
        via: handle,
      })
    }
  }

  return [...byRef.values()]
}
