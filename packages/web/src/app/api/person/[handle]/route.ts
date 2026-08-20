import { NextResponse } from 'next/server'
import { getAuthorProfile } from '@/lib/registry'
import type { Skill } from '@/lib/types'
import type { PersonCardData } from '@/app/(consumer)/skills/person-directory-card'

/** Top-3 categories this person engages with — counted across the public skills
 *  they've PUBLISHED and the skills they've SAVED — so a curator who saves but
 *  hasn't authored still gets a real "what they're into" signal, not a blank row. */
function topCategoryKeys(
  published: Skill[],
  savedCategories: (string | null)[],
): string[] {
  const counts = new Map<string, number>()
  for (const s of published) {
    if (s.visibility === 'private' || !s.category) continue
    counts.set(s.category, (counts.get(s.category) ?? 0) + 1)
  }
  for (const c of savedCategories) {
    if (!c) continue
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key]) => key)
}

/**
 * Person card data for a handle — the source for the lazy actor hover card.
 * Fetched on hover (client-side) rather than baked into every feed event, so
 * rows stay light and client-renderable. Returns the rich profile (categories +
 * followers · following · skills · kits); `null` for an unknown handle.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const p = await getAuthorProfile(handle, { withSession: true })
  if (!p) return NextResponse.json(null)
  const person: PersonCardData = {
    handle: p.username,
    name: p.displayName || p.username,
    avatarUrl: p.avatarUrl ?? null,
    categories: topCategoryKeys(p.skills, (p.savedSkills ?? []).map((s) => s.category)),
    totalInstalls: p.totalInstalls ?? 0,
    followers: p.followers ?? 0,
    publicSkills: p.skills.filter((s) => s.visibility !== 'private').length,
    following: p.following,
    kits: p.kits?.filter((k) => k.visibility !== 'private').length,
    viewerFollows: p.followedByMe ?? false,
  }
  return NextResponse.json(person)
}
