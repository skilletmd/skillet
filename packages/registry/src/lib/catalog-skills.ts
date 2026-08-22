// Public catalog skill reads for the MySQL/Prisma path (U4 catalog wave).
// Mirrors the GET /v1/skills visibility filters and summary joins.
import type { Prisma } from '@prisma/client'
import type { PrismaDb } from '../db/prisma-client.js'
import type { SkillSummaryRow } from '../routes/skill-summary.js'

/** Sort keys accepted by the public catalog list. */
export type CatalogSkillSort = 'installs' | 'new' | 'alpha'

export interface ListPublicCatalogSkillsPrismaOptions {
  limit: number
  offset: number
  /** Case-insensitive substring match on slug/description. */
  q?: string
  categories?: string[]
  sort?: CatalogSkillSort
}

/** Compact row returned by {@link listPublicCatalogSkillsPrisma}. */
export interface PublicCatalogSkillRow {
  id: string
  author_id: string
  slug: string
  description: string | null
  latest_hash: string | null
  visibility: string
  install_count: number
  created_at: number
  category: string | null
  moderation_status: string
  is_featured: number
}

export type CatalogUsedByFace = {
  handle: string
  name: string | null
  avatar_url: string | null
}

async function suspendedAuthorHandles(prisma: PrismaDb): Promise<string[]> {
  const rows = await prisma.users.findMany({
    where: { suspended_at: { not: null }, handle: { not: null } },
    select: { handle: true },
  })
  return rows
    .map((row) => row.handle)
    .filter((handle): handle is string => typeof handle === 'string' && handle.length > 0)
}

function publicCatalogWhere(
  suspendedHandles: string[],
  opts: Pick<ListPublicCatalogSkillsPrismaOptions, 'q' | 'categories'>,
): Prisma.skillsWhereInput {
  const where: Prisma.skillsWhereInput = {
    latest_hash: { not: null },
    visibility: 'public',
    deprecated_at: null,
    moderation_status: { not: 'unlisted' },
  }

  if (suspendedHandles.length > 0) {
    where.author_id = { notIn: suspendedHandles }
  }

  const q = opts.q?.trim()
  if (q) {
    where.OR = [
      { slug: { contains: q } },
      { description: { contains: q } },
    ]
  }

  if (opts.categories && opts.categories.length > 0) {
    where.category = { in: opts.categories }
  }

  return where
}

function catalogOrderBy(
  sort: CatalogSkillSort | undefined,
): Prisma.skillsOrderByWithRelationInput[] {
  // Featured skills always float first, matching the sqlite catalog ORDER BY.
  const featuredFirst: Prisma.skillsOrderByWithRelationInput = { is_featured: 'desc' }
  if (sort === 'new') {
    return [featuredFirst, { created_at: 'desc' }, { install_count: 'desc' }]
  }
  if (sort === 'alpha') {
    return [featuredFirst, { slug: 'asc' }]
  }
  return [featuredFirst, { install_count: 'desc' }, { created_at: 'desc' }]
}

/** Count of skills visible on the anonymous public catalog. */
export async function countPublicCatalogSkillsPrisma(
  prisma: PrismaDb,
  opts: Pick<ListPublicCatalogSkillsPrismaOptions, 'q' | 'categories'> = {},
): Promise<number> {
  const suspendedHandles = await suspendedAuthorHandles(prisma)
  return prisma.skills.count({ where: publicCatalogWhere(suspendedHandles, opts) })
}

/** Page of public catalog skills (same filters as GET /v1/skills). */
export async function listPublicCatalogSkillsPrisma(
  prisma: PrismaDb,
  opts: ListPublicCatalogSkillsPrismaOptions,
): Promise<PublicCatalogSkillRow[]> {
  const suspendedHandles = await suspendedAuthorHandles(prisma)
  const rows = await prisma.skills.findMany({
    where: publicCatalogWhere(suspendedHandles, opts),
    orderBy: catalogOrderBy(opts.sort),
    skip: opts.offset,
    take: opts.limit,
    select: {
      id: true,
      author_id: true,
      slug: true,
      description: true,
      latest_hash: true,
      visibility: true,
      install_count: true,
      created_at: true,
      category: true,
      moderation_status: true,
      is_featured: true,
    },
  })
  return rows
}

/**
 * Public catalog page with the same joined fields as SKILL_SUMMARY_SELECT,
 * so GET /v1/skills can map through {@link toSkillSummary} unchanged.
 */
export async function listPublicCatalogSkillSummariesPrisma(
  prisma: PrismaDb,
  opts: ListPublicCatalogSkillsPrismaOptions,
): Promise<SkillSummaryRow[]> {
  const skills = await listPublicCatalogSkillsPrisma(prisma, opts)
  if (skills.length === 0) return []

  const authorIds = [...new Set(skills.map((s) => s.author_id))]
  const versionPairs = skills
    .filter((s): s is PublicCatalogSkillRow & { latest_hash: string } => Boolean(s.latest_hash))
    .map((s) => ({ skill_id: s.id, hash: s.latest_hash }))

  const [users, authors, versions, versionCounts, scans] = await Promise.all([
    prisma.users.findMany({
      where: { handle: { in: authorIds } },
      select: { handle: true, author_key_id: true },
    }),
    // One batched lookup per page (not per row) so every catalog card can draw
    // its byline avatar without the web app fanning out to the people catalog.
    // `authors.id` is the handle, so this covers mirror brands as well as users.
    prisma.authors.findMany({
      where: { id: { in: authorIds } },
      select: { id: true, avatar_url: true },
    }),
    versionPairs.length === 0
      ? Promise.resolve([])
      : prisma.skill_versions.findMany({
          where: { OR: versionPairs },
          select: {
            skill_id: true,
            hash: true,
            major: true,
            minor: true,
            patch: true,
            signature_b64: true,
            signature_key_id: true,
          },
        }),
    prisma.skill_versions.groupBy({
      by: ['skill_id'],
      where: { skill_id: { in: skills.map((s) => s.id) } },
      _count: { _all: true },
    }),
    versionPairs.length === 0
      ? Promise.resolve([])
      : prisma.skill_version_scans.findMany({
          where: {
            OR: versionPairs.map((p) => ({
              skill_id: p.skill_id,
              skill_version_id: p.hash,
            })),
          },
          select: { skill_id: true, skill_version_id: true, status: true },
        }),
  ])

  const registeredKeyByHandle = new Map(
    users
      .filter((u): u is typeof u & { handle: string } => typeof u.handle === 'string')
      .map((u) => [u.handle, u.author_key_id]),
  )
  const avatarByHandle = new Map(authors.map((a) => [a.id, a.avatar_url ?? null]))
  const versionByKey = new Map(versions.map((v) => [`${v.skill_id}\0${v.hash}`, v]))
  const countBySkill = new Map(versionCounts.map((c) => [c.skill_id, c._count._all]))
  const scanByKey = new Map(
    scans.map((s) => [`${s.skill_id}\0${s.skill_version_id}`, s.status]),
  )

  return skills.map((s) => {
    const latest = s.latest_hash
      ? versionByKey.get(`${s.id}\0${s.latest_hash}`)
      : undefined
    const visibility = s.visibility === 'public' ? 'public' : 'private'
    return {
      author_id: s.author_id,
      author_avatar_url: avatarByHandle.get(s.author_id) ?? null,
      slug: s.slug,
      skill_id: s.id,
      description: s.description,
      visibility,
      latest_hash: s.latest_hash,
      version: countBySkill.get(s.id) ?? 0,
      latest_major: latest?.major ?? null,
      latest_minor: latest?.minor ?? null,
      latest_patch: latest?.patch ?? null,
      install_count: s.install_count,
      created_at: s.created_at,
      signature_b64: latest?.signature_b64 ?? null,
      signature_key_id: latest?.signature_key_id ?? null,
      registered_key_id: registeredKeyByHandle.get(s.author_id) ?? null,
      scan_status: s.latest_hash
        ? (scanByKey.get(`${s.id}\0${s.latest_hash}`) ?? null)
        : null,
      moderation_status: s.moderation_status,
      category: s.category,
    }
  })
}

/** Load one skill by id when it passes public catalog visibility filters. */
export async function findPublicCatalogSkillPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<PublicCatalogSkillRow | null> {
  const suspendedHandles = await suspendedAuthorHandles(prisma)
  const where = publicCatalogWhere(suspendedHandles, {})
  return prisma.skills.findFirst({
    where: { ...where, id: skillId },
    select: {
      id: true,
      author_id: true,
      slug: true,
      description: true,
      latest_hash: true,
      visibility: true,
      install_count: true,
      created_at: true,
      category: true,
      moderation_status: true,
      is_featured: true,
    },
  })
}

/**
 * Batched "used by" faces for catalog cards (kit curators + public-kit subscribers).
 * Handles are sorted ascending to match the sqlite GROUP BY path.
 */
export async function catalogUsedByFacesPrisma(
  prisma: PrismaDb,
  skillIds: string[],
): Promise<Map<string, CatalogUsedByFace[]>> {
  const out = new Map<string, CatalogUsedByFace[]>()
  if (skillIds.length === 0) return out

  const suspended = new Set(await suspendedAuthorHandles(prisma))

  const [kitMembers, subscribers] = await Promise.all([
    prisma.kit_skills.findMany({
      where: {
        skill_id: { in: skillIds },
        kits: {
          OR: [{ visibility: 'public' }, { kind: 'saved' }],
        },
      },
      select: {
        skill_id: true,
        kits: { select: { owner_id: true } },
      },
    }),
    prisma.kit_subscriptions.findMany({
      where: {
        kind: 'kit',
        kits: {
          visibility: 'public',
          kit_skills: { some: { skill_id: { in: skillIds } } },
        },
      },
      select: {
        users: { select: { handle: true } },
        kits: {
          select: {
            kit_skills: {
              where: { skill_id: { in: skillIds } },
              select: { skill_id: true },
            },
          },
        },
      },
    }),
  ])

  const handlesBySkill = new Map<string, Set<string>>()
  const addHandle = (skillId: string, handle: string | null | undefined) => {
    if (!handle || suspended.has(handle)) return
    let set = handlesBySkill.get(skillId)
    if (!set) {
      set = new Set()
      handlesBySkill.set(skillId, set)
    }
    set.add(handle)
  }

  for (const row of kitMembers) {
    addHandle(row.skill_id, row.kits.owner_id)
  }
  for (const sub of subscribers) {
    const handle = sub.users.handle
    for (const ks of sub.kits?.kit_skills ?? []) {
      addHandle(ks.skill_id, handle)
    }
  }

  const allHandles = [...new Set([...handlesBySkill.values()].flatMap((s) => [...s]))]
  const authors =
    allHandles.length === 0
      ? []
      : await prisma.authors.findMany({
          where: { id: { in: allHandles } },
          select: { id: true, name: true, avatar_url: true },
        })
  const authorById = new Map(authors.map((a) => [a.id, a]))

  for (const [skillId, handles] of handlesBySkill) {
    const faces = [...handles]
      .sort((a, b) => a.localeCompare(b))
      .map((handle) => {
        const author = authorById.get(handle)
        return {
          handle,
          name: author?.name ?? null,
          avatar_url: author?.avatar_url ?? null,
        }
      })
    out.set(skillId, faces)
  }
  return out
}
