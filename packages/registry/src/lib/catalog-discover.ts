// Public discover kits/people catalog reads for the MySQL/Prisma path (U4).
// Category and facepile fields are derived in-process so we avoid sqlite-only
// SQL dialects (strftime, correlated subqueries) on the cutover path.
import type { PrismaDb } from '../db/prisma-client.js'

export type DiscoverKitSort = 'installs' | 'new' | 'alpha'

export interface ListDiscoverKitsPrismaOptions {
  limit: number
  offset: number
  q?: string
  categories?: string[]
  sort?: DiscoverKitSort
}

export interface DiscoverKitRow {
  id: string
  owner_id: string
  name: string
  slug: string | null
  description: string | null
  created_at: number
  skill_count: number
  subscriber_count: number
  category: string | null
  skill_ids: string[]
  skill_categories: (string | null)[]
}

async function suspendedHandles(prisma: PrismaDb): Promise<string[]> {
  const rows = await prisma.users.findMany({
    where: { suspended_at: { not: null }, handle: { not: null } },
    select: { handle: true },
  })
  return rows
    .map((row) => row.handle)
    .filter((handle): handle is string => typeof handle === 'string' && handle.length > 0)
}

function kitPluralityCategory(
  members: Array<{ category: string | null; install_count: number }>,
): string | null {
  const byCategory = new Map<string, { count: number; installs: number }>()
  for (const m of members) {
    if (!m.category) continue
    const cur = byCategory.get(m.category) ?? { count: 0, installs: 0 }
    cur.count += 1
    cur.installs += m.install_count
    byCategory.set(m.category, cur)
  }
  let best: string | null = null
  let bestCount = -1
  let bestInstalls = -1
  for (const [category, stats] of byCategory) {
    if (
      stats.count > bestCount ||
      (stats.count === bestCount && stats.installs > bestInstalls)
    ) {
      best = category
      bestCount = stats.count
      bestInstalls = stats.installs
    }
  }
  return best
}

interface DiscoverKitWorkRow extends DiscoverKitRow {
  is_featured: number
}

async function loadDiscoverKitsPrisma(
  prisma: PrismaDb,
  opts: Pick<ListDiscoverKitsPrismaOptions, 'q' | 'categories' | 'sort'>,
): Promise<DiscoverKitWorkRow[]> {
  const suspended = await suspendedHandles(prisma)
  const q = opts.q?.trim()

  const kits = await prisma.kits.findMany({
    where: {
      visibility: 'public',
      moderation_status: 'none',
      ...(suspended.length > 0 ? { owner_id: { notIn: suspended } } : {}),
      ...(q
        ? {
            OR: [{ name: { contains: q } }, { description: { contains: q } }],
          }
        : {}),
    },
    select: {
      id: true,
      owner_id: true,
      name: true,
      slug: true,
      description: true,
      created_at: true,
      is_featured: true,
      kit_skills: {
        select: {
          skill_id: true,
          skills: { select: { category: true, install_count: true, visibility: true } },
        },
      },
      kit_subscriptions: {
        where: { kind: 'kit' },
        select: { id: true },
      },
    },
  })

  let filtered: DiscoverKitWorkRow[] = kits.map((kit) => {
    // Only public members are surfaced. A member privatized after being added to
    // this public kit (#461) must not leak its id or category, and skill_count
    // must count public members only so it can't be differenced against a full
    // count to infer a hidden one.
    const members = kit.kit_skills
      .filter((ks) => ks.skills.visibility === 'public')
      .map((ks) => ({
        skill_id: ks.skill_id,
        category: ks.skills.category,
        install_count: ks.skills.install_count,
      }))
    return {
      id: kit.id,
      owner_id: kit.owner_id,
      name: kit.name,
      slug: kit.slug,
      description: kit.description,
      created_at: kit.created_at,
      is_featured: kit.is_featured,
      skill_count: members.length,
      subscriber_count: kit.kit_subscriptions.length,
      category: kitPluralityCategory(members),
      skill_ids: members.map((m) => m.skill_id),
      skill_categories: members.map((m) => m.category),
    }
  })

  if (opts.categories && opts.categories.length > 0) {
    const allow = new Set(opts.categories)
    filtered = filtered.filter((k) => k.category != null && allow.has(k.category))
  }

  const sort = opts.sort ?? 'installs'
  filtered.sort((a, b) => {
    if (b.is_featured !== a.is_featured) return b.is_featured - a.is_featured
    if (sort === 'new') return b.created_at - a.created_at
    if (sort === 'alpha') {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    }
    if (b.subscriber_count !== a.subscriber_count) {
      return b.subscriber_count - a.subscriber_count
    }
    if (b.skill_count !== a.skill_count) return b.skill_count - a.skill_count
    return b.created_at - a.created_at
  })

  return filtered
}

/** Count of kits visible on the anonymous discover catalog. */
export async function countDiscoverKitsPrisma(
  prisma: PrismaDb,
  opts: Pick<ListDiscoverKitsPrismaOptions, 'q' | 'categories'> = {},
): Promise<number> {
  const kits = await loadDiscoverKitsPrisma(prisma, opts)
  return kits.length
}

/** Page of public discover kits (featured first, then sort). */
export async function listDiscoverKitsPrisma(
  prisma: PrismaDb,
  opts: ListDiscoverKitsPrismaOptions,
): Promise<DiscoverKitRow[]> {
  const kits = await loadDiscoverKitsPrisma(prisma, opts)
  return kits.slice(opts.offset, opts.offset + opts.limit).map(({ is_featured: _f, ...row }) => row)
}

export type DiscoverKitUsedByFace = {
  handle: string
  name: string | null
  avatar_url: string | null
}

/** Up to 3 most-recent real subscribers per kit (owner excluded by the caller). */
export async function discoverKitSubscriberFacesPrisma(
  prisma: PrismaDb,
  kitIds: string[],
): Promise<Map<string, DiscoverKitUsedByFace[]>> {
  const out = new Map<string, DiscoverKitUsedByFace[]>()
  if (kitIds.length === 0) return out

  const subs = await prisma.kit_subscriptions.findMany({
    where: {
      kind: 'kit',
      kit_id: { in: kitIds },
      users: { suspended_at: null },
    },
    orderBy: { created_at: 'desc' },
    select: {
      kit_id: true,
      created_at: true,
      users: { select: { handle: true } },
    },
  })

  const handles = [
    ...new Set(
      subs
        .map((s) => s.users.handle)
        .filter((h): h is string => typeof h === 'string' && h.length > 0),
    ),
  ]
  const authors =
    handles.length === 0
      ? []
      : await prisma.authors.findMany({
          where: { id: { in: handles } },
          select: { id: true, name: true, avatar_url: true },
        })
  const authorById = new Map(authors.map((a) => [a.id, a]))

  for (const sub of subs) {
    if (!sub.kit_id || !sub.users.handle) continue
    const arr = out.get(sub.kit_id) ?? []
    if (arr.length >= 3) continue
    if (arr.some((f) => f.handle === sub.users.handle)) continue
    const author = authorById.get(sub.users.handle)
    arr.push({
      handle: sub.users.handle,
      name: author?.name ?? null,
      avatar_url: author?.avatar_url ?? null,
    })
    out.set(sub.kit_id, arr)
  }
  return out
}

export type DiscoverPeopleSort = 'installs' | 'followers' | 'new' | 'alpha'

export interface ListDiscoverPeoplePrismaOptions {
  limit: number
  offset: number
  q?: string
  categories?: string[]
  sort?: DiscoverPeopleSort
}

export interface DiscoverPersonRow {
  id: string
  name: string
  avatar_url: string | null
  bio: string | null
  created_at: number
  followers: number
  following: number
  public_skills: number
  kits: number
  total_installs: number
  category: string | null
  categories: string[]
}

function authorPluralityCategories(
  skills: Array<{ category: string | null; install_count: number }>,
): { primary: string | null; top: string[] } {
  const byCategory = new Map<string, { count: number; installs: number }>()
  for (const s of skills) {
    if (!s.category) continue
    const cur = byCategory.get(s.category) ?? { count: 0, installs: 0 }
    cur.count += 1
    cur.installs += s.install_count
    byCategory.set(s.category, cur)
  }
  const ranked = [...byCategory.entries()].sort((a, b) => {
    if (b[1].count !== a[1].count) return b[1].count - a[1].count
    return b[1].installs - a[1].installs
  })
  return {
    primary: ranked[0]?.[0] ?? null,
    top: ranked.slice(0, 3).map(([c]) => c),
  }
}

/**
 * Distinct external adopters across many authors in one pass (kit curators +
 * public-kit subscribers), matching countSkillAdoptersPrisma semantics.
 */
async function adopterCountsByAuthorPrisma(
  prisma: PrismaDb,
  authorIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (const id of authorIds) out.set(id, 0)
  if (authorIds.length === 0) return out

  const suspended = new Set(await suspendedHandles(prisma))
  const authorSet = new Set(authorIds)

  const publicSkills = await prisma.skills.findMany({
    where: {
      author_id: { in: authorIds },
      visibility: 'public',
      moderation_status: { not: 'unlisted' },
    },
    select: { id: true, author_id: true },
  })
  const skillAuthor = new Map(publicSkills.map((s) => [s.id, s.author_id]))
  const skillIds = publicSkills.map((s) => s.id)

  const handlesByAuthor = new Map<string, Set<string>>()
  const add = (authorId: string, handle: string) => {
    if (!authorSet.has(authorId)) return
    if (handle === authorId || suspended.has(handle)) return
    const set = handlesByAuthor.get(authorId) ?? new Set<string>()
    set.add(handle)
    handlesByAuthor.set(authorId, set)
  }

  if (skillIds.length > 0) {
    const kitSkills = await prisma.kit_skills.findMany({
      where: { skill_id: { in: skillIds } },
      select: {
        skill_id: true,
        kits: { select: { owner_id: true, visibility: true, kind: true } },
      },
    })
    for (const ks of kitSkills) {
      if (ks.kits.visibility !== 'public' && ks.kits.kind !== 'saved') continue
      const authorId = skillAuthor.get(ks.skill_id)
      if (authorId) add(authorId, ks.kits.owner_id)
    }
  }

  const authorKits = await prisma.kits.findMany({
    where: { owner_id: { in: authorIds }, visibility: 'public' },
    select: { id: true, owner_id: true },
  })
  if (authorKits.length > 0) {
    const kitOwner = new Map(authorKits.map((k) => [k.id, k.owner_id]))
    const subs = await prisma.kit_subscriptions.findMany({
      where: {
        kind: 'kit',
        kit_id: { in: authorKits.map((k) => k.id) },
      },
      select: {
        kit_id: true,
        users: { select: { handle: true } },
      },
    })
    for (const sub of subs) {
      if (!sub.kit_id || !sub.users.handle) continue
      const owner = kitOwner.get(sub.kit_id)
      if (owner) add(owner, sub.users.handle)
    }
  }

  for (const [authorId, set] of handlesByAuthor) {
    out.set(authorId, set.size)
  }
  return out
}

async function loadDiscoverPeoplePrisma(
  prisma: PrismaDb,
  opts: Pick<ListDiscoverPeoplePrismaOptions, 'q' | 'categories' | 'sort'>,
): Promise<DiscoverPersonRow[]> {
  const suspended = await suspendedHandles(prisma)
  const q = opts.q?.trim().toLowerCase()

  const authors = await prisma.authors.findMany({
    where: suspended.length > 0 ? { id: { notIn: suspended } } : {},
    select: {
      id: true,
      name: true,
      avatar_url: true,
      bio: true,
      created_at: true,
    },
  })

  if (authors.length === 0) return []

  const authorIds = authors.map((a) => a.id)

  const [publicSkills, followCounts, users, publicKits] = await Promise.all([
    prisma.skills.findMany({
      where: {
        author_id: { in: authorIds },
        visibility: 'public',
        latest_hash: { not: null },
        moderation_status: { not: 'unlisted' },
      },
      select: {
        author_id: true,
        category: true,
        install_count: true,
      },
    }),
    prisma.follow_counts.findMany({
      where: {
        subject_kind: 'author',
        subject_id: { in: authorIds },
      },
      select: { subject_id: true, followers: true },
    }),
    prisma.users.findMany({
      where: { handle: { in: authorIds } },
      select: {
        handle: true,
        follows: {
          where: { subject_kind: 'author' },
          select: { subject_id: true },
        },
      },
    }),
    prisma.kits.findMany({
      where: {
        owner_id: { in: authorIds },
        visibility: 'public',
        moderation_status: 'none',
      },
      select: { owner_id: true },
    }),
  ])

  const skillsByAuthor = new Map<string, Array<{ category: string | null; install_count: number }>>()
  for (const s of publicSkills) {
    const arr = skillsByAuthor.get(s.author_id) ?? []
    arr.push({ category: s.category, install_count: s.install_count })
    skillsByAuthor.set(s.author_id, arr)
  }
  const followersByAuthor = new Map(followCounts.map((f) => [f.subject_id, f.followers]))
  const followingByHandle = new Map(
    users
      .filter((u): u is typeof u & { handle: string } => typeof u.handle === 'string')
      .map((u) => [u.handle, u.follows.length]),
  )
  const kitsByAuthor = new Map<string, number>()
  for (const k of publicKits) {
    kitsByAuthor.set(k.owner_id, (kitsByAuthor.get(k.owner_id) ?? 0) + 1)
  }

  const installsByAuthor = await adopterCountsByAuthorPrisma(prisma, authorIds)

  let rows: DiscoverPersonRow[] = authors.map((a) => {
    const skills = skillsByAuthor.get(a.id) ?? []
    const cats = authorPluralityCategories(skills)
    return {
      id: a.id,
      name: a.name,
      avatar_url: a.avatar_url,
      bio: a.bio,
      created_at: a.created_at,
      followers: followersByAuthor.get(a.id) ?? 0,
      following: followingByHandle.get(a.id) ?? 0,
      public_skills: skills.length,
      kits: kitsByAuthor.get(a.id) ?? 0,
      total_installs: installsByAuthor.get(a.id) ?? 0,
      category: cats.primary,
      categories: cats.top,
    }
  })

  // Qualify: at least one public skill OR one follower (matches sqlite).
  rows = rows.filter((r) => r.public_skills > 0 || r.followers > 0)

  if (q) {
    rows = rows.filter(
      (r) => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    )
  }
  if (opts.categories && opts.categories.length > 0) {
    const allow = new Set(opts.categories)
    rows = rows.filter((r) => r.category != null && allow.has(r.category))
  }

  const sort = opts.sort ?? 'installs'
  rows.sort((a, b) => {
    if (sort === 'followers') {
      if (b.followers !== a.followers) return b.followers - a.followers
      return b.total_installs - a.total_installs
    }
    if (sort === 'new') return b.created_at - a.created_at
    if (sort === 'alpha') {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    }
    if (b.total_installs !== a.total_installs) return b.total_installs - a.total_installs
    if (b.followers !== a.followers) return b.followers - a.followers
    if (b.public_skills !== a.public_skills) return b.public_skills - a.public_skills
    return b.created_at - a.created_at
  })

  return rows
}

/** Count of people visible on the anonymous discover catalog. */
export async function countDiscoverPeoplePrisma(
  prisma: PrismaDb,
  opts: Pick<ListDiscoverPeoplePrismaOptions, 'q' | 'categories'> = {},
): Promise<number> {
  const people = await loadDiscoverPeoplePrisma(prisma, opts)
  return people.length
}

/** Page of discover people (qualified authors). */
export async function listDiscoverPeoplePrisma(
  prisma: PrismaDb,
  opts: ListDiscoverPeoplePrismaOptions,
): Promise<DiscoverPersonRow[]> {
  const people = await loadDiscoverPeoplePrisma(prisma, opts)
  return people.slice(opts.offset, opts.offset + opts.limit)
}
