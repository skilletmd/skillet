// Public kits that contain a given skill (GET /skills/:author/:slug/kits).
import type { PrismaDb } from '../db/prisma-client.js'

export type SkillKitListItem = {
  id: string
  owner: string
  name: string
  slug: string
  skill_count: number
  subscriber_count: number
  skill_ids: string[]
  skill_categories: Array<string | null>
  category: string | null
}

async function suspendedHandles(prisma: PrismaDb): Promise<Set<string>> {
  const rows = await prisma.users.findMany({
    where: { suspended_at: { not: null }, handle: { not: null } },
    select: { handle: true },
  })
  return new Set(
    rows
      .map((r) => r.handle)
      .filter((h): h is string => typeof h === 'string' && h.length > 0),
  )
}

/** Public kits curating `skillId`, ordered like the sqlite skill kits route. */
export async function listPublicKitsForSkillPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<SkillKitListItem[]> {
  const suspended = await suspendedHandles(prisma)
  const memberships = await prisma.kit_skills.findMany({
    where: {
      skill_id: skillId,
      // The auto "Saved" kit is a personal bucket, not a curated kit — never
      // surface it in "In these kits", even when a user made it public.
      kits: { visibility: 'public', kind: { not: 'saved' } },
    },
    select: {
      kits: {
        select: {
          id: true,
          owner_id: true,
          name: true,
          slug: true,
          kit_skills: {
            select: {
              skill_id: true,
              skills: {
                select: {
                  category: true,
                  visibility: true,
                  latest_hash: true,
                  install_count: true,
                },
              },
            },
          },
          _count: {
            select: {
              kit_subscriptions: { where: { kind: 'kit' } },
            },
          },
        },
      },
    },
  })

  const items: SkillKitListItem[] = []
  for (const m of memberships) {
    const k = m.kits
    if (suspended.has(k.owner_id)) continue

    // Only public members are surfaced (a member privatized after being added to
    // this public kit must not leak its id/category, #461). skill_count counts
    // public members only so it can't be differenced to infer a hidden one.
    const publicMembers = k.kit_skills.filter((ks) => ks.skills.visibility === 'public')
    const skillIds = publicMembers.map((ks) => ks.skill_id)
    const skillCategories = publicMembers.map((ks) => ks.skills.category ?? null)

    // Dominant public category by membership count, then install_count.
    const catAgg = new Map<string, { count: number; installs: number }>()
    for (const ks of k.kit_skills) {
      const s = ks.skills
      if (s.visibility !== 'public' || !s.latest_hash || !s.category) continue
      const cur = catAgg.get(s.category) ?? { count: 0, installs: 0 }
      cur.count += 1
      cur.installs += s.install_count
      catAgg.set(s.category, cur)
    }
    let category: string | null = null
    let best: { count: number; installs: number } | null = null
    for (const [cat, agg] of catAgg) {
      if (
        !best ||
        agg.count > best.count ||
        (agg.count === best.count && agg.installs > best.installs)
      ) {
        best = agg
        category = cat
      }
    }

    items.push({
      id: k.id,
      owner: k.owner_id,
      name: k.name,
      slug: k.slug ?? '',
      skill_count: publicMembers.length,
      subscriber_count: k._count.kit_subscriptions,
      skill_ids: skillIds,
      skill_categories: skillCategories,
      category,
    })
  }

  items.sort((a, b) => {
    if (b.subscriber_count !== a.subscriber_count) {
      return b.subscriber_count - a.subscriber_count
    }
    if (b.skill_count !== a.skill_count) return b.skill_count - a.skill_count
    return a.name.localeCompare(b.name)
  })
  return items
}
