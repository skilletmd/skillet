// Author page assembly for the MySQL/Prisma path (U4).
import type { PrismaDb } from '../db/prisma-client.js'
import {
  getFollowerCountPrisma,
  getFollowingCountPrisma,
  getUserIdByHandlePrisma,
  isFollowingPrisma,
} from './follow-graph.js'
import {
  canAccessOrgAuthorPrisma,
  getOrgBySlugPrisma,
} from './org-access.js'
import { countSkillAdoptersPrisma } from './profile-payload.js'
import { isHandleSuspendedPrisma } from './suspension.js'
import {
  toSkillSummary,
  type SkillSummary,
  type SkillSummaryRow,
} from '../routes/skill-summary.js'
import { parseStoredAgents } from '../routes/device-agents.js'
import type { UserSocialLinks } from '../auth/identities.js'

function normalizeSourceOwnerType(
  raw: string | null,
): 'User' | 'Organization' | null {
  if (raw === 'User' || raw === 'Organization') return raw
  return null
}

/** Plurality category among a kit's members that carry one (parity with sqlite). */
function pluralityCategory(categories: (string | null)[]): string | null {
  const counts = new Map<string, number>()
  for (const c of categories) {
    if (!c) continue
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let category: string | null = null
  let best = -1
  for (const [c, n] of counts) {
    if (n > best) {
      best = n
      category = c
    }
  }
  return category
}

function parseShownAgents(raw: string | null): string[] | null {
  if (raw == null) return null
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null
  } catch {
    return null
  }
}

async function skillSummariesForAuthorPrisma(
  prisma: PrismaDb,
  authorId: string,
  includePrivate: boolean,
): Promise<SkillSummary[]> {
  const skills = await prisma.skills.findMany({
    where: {
      author_id: authorId,
      latest_hash: { not: null },
      // Deprecated (unlisted) skills stay visible to the owner/org so the
      // profile can badge + restore them; the public list hides them entirely,
      // matching the catalog. (They used to leak into the public grid.)
      ...(includePrivate
        ? {}
        : { visibility: 'public', moderation_status: { not: 'unlisted' }, deprecated_at: null }),
    },
    orderBy: [{ install_count: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      author_id: true,
      slug: true,
      description: true,
      visibility: true,
      latest_hash: true,
      install_count: true,
      created_at: true,
      category: true,
      moderation_status: true,
      deprecated_at: true,
    },
  })
  if (skills.length === 0) return []

  const versionPairs = skills
    .filter((s): s is typeof s & { latest_hash: string } => Boolean(s.latest_hash))
    .map((s) => ({ skill_id: s.id, hash: s.latest_hash }))

  const [user, versions, versionCounts, scans] = await Promise.all([
    prisma.users.findUnique({
      where: { handle: authorId },
      select: { author_key_id: true },
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

  const versionByKey = new Map(versions.map((v) => [`${v.skill_id}\0${v.hash}`, v]))
  const countBySkill = new Map(versionCounts.map((c) => [c.skill_id, c._count._all]))
  const scanByKey = new Map(
    scans.map((s) => [`${s.skill_id}\0${s.skill_version_id}`, s.status]),
  )
  const registeredKey = user?.author_key_id ?? null

  const rows: SkillSummaryRow[] = skills.map((s) => {
    const latest = s.latest_hash
      ? versionByKey.get(`${s.id}\0${s.latest_hash}`)
      : undefined
    return {
      author_id: s.author_id,
      slug: s.slug,
      skill_id: s.id,
      description: s.description,
      visibility: s.visibility === 'public' ? 'public' : 'private',
      latest_hash: s.latest_hash,
      version: countBySkill.get(s.id) ?? 0,
      latest_major: latest?.major ?? null,
      latest_minor: latest?.minor ?? null,
      latest_patch: latest?.patch ?? null,
      install_count: s.install_count,
      created_at: s.created_at,
      signature_b64: latest?.signature_b64 ?? null,
      signature_key_id: latest?.signature_key_id ?? null,
      registered_key_id: registeredKey,
      scan_status: s.latest_hash
        ? (scanByKey.get(`${s.id}\0${s.latest_hash}`) ?? null)
        : null,
      moderation_status: s.moderation_status,
      category: s.category,
      deprecated_at: s.deprecated_at,
    }
  })
  return rows.map(toSkillSummary)
}

async function listAuthorKitsPrisma(
  prisma: PrismaDb,
  authorId: string,
  opts: { includePrivate: boolean; viewerUserId: string | null },
) {
  const kits = await prisma.kits.findMany({
    where: {
      owner_id: authorId,
      profile_hidden: 0,
      kind: { not: 'saved' },
      ...(opts.includePrivate
        ? {}
        : { visibility: 'public', moderation_status: 'none' }),
    },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      visibility: true,
    },
  })
  const owner = await prisma.authors.findUnique({
    where: { id: authorId },
    select: { avatar_url: true },
  })
  const out = []
  for (const k of kits) {
    const members = await prisma.kit_skills.findMany({
      where: { kit_id: k.id },
      select: {
        skill_id: true,
        skills: { select: { category: true } },
      },
    })
    let subscribed = false
    if (opts.viewerUserId) {
      const sub = await prisma.kit_subscriptions.findFirst({
        where: {
          user_id: opts.viewerUserId,
          kind: 'kit',
          kit_id: k.id,
        },
        select: { kit_id: true },
      })
      subscribed = sub != null
    }
    const skill_ids = members.map((m) => m.skill_id)
    const skill_categories = members.map((m) => m.skills.category)
    const category = pluralityCategory(skill_categories)
    out.push({
      id: k.id,
      slug: k.slug,
      owner: authorId,
      name: k.name,
      description: k.description,
      visibility: (k.visibility === 'public' ? 'public' : 'private') as
        | 'public'
        | 'private',
      skill_count: members.length,
      skill_ids,
      skill_categories,
      category,
      avatar_url: owner?.avatar_url ?? null,
      ...(opts.viewerUserId ? { subscribed } : {}),
    })
  }
  return out
}

/**
 * The kits a user subscribed to via the browse/kit checkmark (`kit_subscriptions`
 * with kind='kit') — the "Saved" tab's kit half. A subscription is a public
 * adopter signal (it feeds the profile install count), so it shows on anyone's
 * profile; only subscriptions to *private* kits are hidden from non-owners, so a
 * private kit's existence never leaks. Shaped like {@link listAuthorKitsPrisma}
 * output so the web maps it with the same `mapAuthorKit`.
 */
async function subscribedKitsForUserPrisma(
  prisma: PrismaDb,
  userId: string,
  { includePrivate }: { includePrivate: boolean },
) {
  const subs = await prisma.kit_subscriptions.findMany({
    where: { user_id: userId, kind: 'kit', kit_id: { not: null } },
    orderBy: { created_at: 'asc' },
    select: { kit_id: true },
  })
  const out = []
  for (const sub of subs) {
    if (!sub.kit_id) continue
    const k = await prisma.kits.findUnique({
      where: { id: sub.kit_id },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        visibility: true,
        owner_id: true,
      },
    })
    if (!k) continue
    if (k.visibility !== 'public' && !includePrivate) continue
    const members = await prisma.kit_skills.findMany({
      where: { kit_id: k.id },
      select: { skill_id: true, skills: { select: { category: true } } },
    })
    const owner = await prisma.authors.findUnique({
      where: { id: k.owner_id },
      select: { avatar_url: true },
    })
    const skill_ids = members.map((m) => m.skill_id)
    const skill_categories = members.map((m) => m.skills.category)
    out.push({
      id: k.id,
      slug: k.slug,
      owner: k.owner_id,
      name: k.name,
      description: k.description,
      visibility: (k.visibility === 'public' ? 'public' : 'private') as
        | 'public'
        | 'private',
      skill_count: members.length,
      skill_ids,
      skill_categories,
      category: pluralityCategory(skill_categories),
      avatar_url: owner?.avatar_url ?? null,
      subscribed: true,
    })
  }
  return out
}

/**
 * The authors a user subscribed to (`kit_subscriptions` with kind='author') —
 * the "Saved" tab's author-kit half. Each is a virtual kit of that author's
 * public skills, shaped for the web's `subscribed_author_kits` mapping.
 */
async function subscribedAuthorKitsForUserPrisma(prisma: PrismaDb, userId: string) {
  const subs = await prisma.kit_subscriptions.findMany({
    where: { user_id: userId, kind: 'author', author_id: { not: null } },
    orderBy: { created_at: 'asc' },
    select: { author_id: true },
  })
  const out = []
  for (const sub of subs) {
    if (!sub.author_id) continue
    const profile = await prisma.authors.findUnique({
      where: { id: sub.author_id },
      select: { name: true, avatar_url: true },
    })
    if (!profile) continue
    const skills = await prisma.skills.findMany({
      where: { author_id: sub.author_id, latest_hash: { not: null }, visibility: 'public' },
      orderBy: { created_at: 'asc' },
      select: { id: true, category: true },
    })
    const org = await getOrgBySlugPrisma(prisma, sub.author_id)
    out.push({
      owner: sub.author_id,
      name: profile.name ?? sub.author_id,
      skill_count: skills.length,
      skill_ids: skills.map((s) => s.id),
      skill_categories: skills.map((s) => s.category),
      is_team: org != null,
      avatar_url: profile.avatar_url ?? null,
    })
  }
  return out
}

async function userSocialLinksPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<UserSocialLinks> {
  const rows = await prisma.user_identities.findMany({
    where: {
      user_id: userId,
      provider: { in: ['github', 'twitter'] },
      provider_login: { not: null },
    },
    orderBy: { created_at: 'asc' },
    select: { provider: true, provider_login: true },
  })
  const links: UserSocialLinks = { github: null, twitter: null }
  for (const row of rows) {
    if (!row.provider_login) continue
    if (row.provider === 'github') links.github = row.provider_login
    else if (row.provider === 'twitter') links.twitter = row.provider_login
  }
  return links
}

async function listAuthorDetectedRuntimesPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<string[]> {
  const rows = await prisma.devices.findMany({
    where: { user_id: userId, detected_agents: { not: null } },
    select: { detected_agents: true },
  })
  const set = new Set<string>()
  for (const row of rows) {
    if (!row.detected_agents) continue
    for (const agent of parseStoredAgents(row.detected_agents)) set.add(agent)
  }
  return [...set].sort()
}

/**
 * Prisma counterpart of getAuthorPage. Kits/subs/saved omit some sqlite-only
 * edge cases (moderation-hidden sub filtering parity is approximate) but keep
 * the public author/team page contract for MySQL.
 */
export async function getAuthorPagePrisma(
  prisma: PrismaDb,
  authorId: string,
  caller?: { handle: string | null; userId: string | null },
): Promise<object | null> {
  const author = await prisma.authors.findUnique({
    where: { id: authorId },
    select: {
      id: true,
      name: true,
      avatar_url: true,
      bio: true,
      profile_url: true,
      x_handle: true,
      created_at: true,
      is_mirror: true,
      mirror_source_url: true,
      mirror_claimed_at: true,
      source_owner_type: true,
      agents_public: true,
      shown_agents: true,
    },
  })
  if (!author) return null

  const isMirror = author.is_mirror === 1 && author.mirror_claimed_at == null
  let mirrorLicense: string | null = null
  let sourceOwnerId: number | null = null
  if (isMirror) {
    const mirror = await prisma.skill_mirrors.findFirst({
      where: { skill_id: { startsWith: `${author.id}:` } },
      select: { license: true },
    })
    mirrorLicense = mirror?.license ?? null
    const orgRow = await prisma.organizations.findFirst({
      where: { slug: author.id },
      select: { source_owner_id: true },
    })
    sourceOwnerId = orgRow?.source_owner_id ?? null
  }

  const org = await getOrgBySlugPrisma(prisma, authorId)
  const callerHandle = caller?.handle ?? null
  const callerUserId = caller?.userId ?? null
  const isOwn = callerHandle != null && callerHandle === authorId
  const isOrgMember =
    !!org &&
    callerUserId != null &&
    (await canAccessOrgAuthorPrisma(prisma, authorId, callerUserId))
  const includePrivate = isOwn || isOrgMember

  if (!isOwn && (await isHandleSuspendedPrisma(prisma, authorId))) return null

  const skills = await skillSummariesForAuthorPrisma(prisma, authorId, includePrivate)
  const total_installs = await countSkillAdoptersPrisma(prisma, authorId)

  let teams: Array<{ slug: string; name: string; role: string }> = []
  if (!org) {
    const userRow = await prisma.users.findUnique({
      where: { handle: authorId },
      select: { id: true },
    })
    if (userRow) {
      const memberships = await prisma.organization_members.findMany({
        where: { user_id: userRow.id, accepted_at: { not: null } },
        select: {
          role: true,
          organizations: { select: { slug: true, name: true } },
        },
      })
      teams = memberships
        .map((r) => ({
          slug: r.organizations.slug,
          name: r.organizations.name,
          role: r.role,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    }
  }

  let members: Array<{
    handle: string
    name: string
    avatar_url: string | null
    role: string
  }> = []
  if (org) {
    const memberships = await prisma.organization_members.findMany({
      where: { org_id: org.id, accepted_at: { not: null } },
      select: {
        role: true,
        users_organization_members_user_idTousers: {
          select: { handle: true },
        },
      },
    })
    const handles = memberships
      .map((m) => m.users_organization_members_user_idTousers.handle)
      .filter((h): h is string => !!h)
    const authorRows = await prisma.authors.findMany({
      where: { id: { in: handles } },
      select: { id: true, name: true, avatar_url: true },
    })
    const byHandle = new Map(authorRows.map((a) => [a.id, a]))
    members = memberships
      .map((m) => {
        const handle = m.users_organization_members_user_idTousers.handle
        if (!handle) return null
        const a = byHandle.get(handle)
        return {
          handle,
          name: a?.name ?? handle,
          avatar_url: a?.avatar_url ?? null,
          role: m.role,
        }
      })
      .filter((m): m is NonNullable<typeof m> => m != null)
      .sort((a, b) => {
        const rank = (r: string) => (r === 'owner' ? 0 : r === 'admin' ? 1 : 2)
        return rank(a.role) - rank(b.role)
      })
  }
  const kits = await listAuthorKitsPrisma(prisma, authorId, {
    includePrivate,
    viewerUserId: callerUserId,
  })

  const authorUserId = await getUserIdByHandlePrisma(prisma, author.id)
  // The Saved tab is public social proof — the kits and authors this person
  // subscribed to (so you can see what your friends run). Subscriptions to
  // private kits are hidden from outsiders; the owner sees all of theirs.
  const subscribed_kits = authorUserId
    ? await subscribedKitsForUserPrisma(prisma, authorUserId, { includePrivate: isOwn })
    : []
  const subscribed_author_kits = authorUserId
    ? await subscribedAuthorKitsForUserPrisma(prisma, authorUserId)
    : []
  // Individually-saved skills live in the owner's auto "Saved" kit (kind='saved').
  // It's a private library, so surface its members to the owner only.
  let saved_skills: Array<{
    skill_id: string
    description: string | null
    category: string | null
  }> = []
  if (isOwn) {
    const savedKit = await prisma.kits.findFirst({
      where: { owner_id: author.id, kind: 'saved' },
      select: { id: true },
    })
    if (savedKit) {
      const members = await prisma.kit_skills.findMany({
        where: { kit_id: savedKit.id },
        select: { skill_id: true, skills: { select: { description: true, category: true } } },
      })
      saved_skills = members.map((m) => ({
        skill_id: m.skill_id,
        description: m.skills?.description ?? null,
        category: m.skills?.category ?? null,
      }))
    }
  }

  const agentsPublic = author.agents_public !== 0
  const detectedSet =
    authorUserId != null
      ? new Set(await listAuthorDetectedRuntimesPrisma(prisma, authorUserId))
      : new Set<string>()
  const shownAgentsRaw = parseShownAgents(author.shown_agents)
  const shownKeys =
    shownAgentsRaw !== null ? shownAgentsRaw : agentsPublic ? [...detectedSet].sort() : []
  const runtimes = shownKeys.map((key) => ({ key, verified: detectedSet.has(key) }))
  const detected_runtimes = shownKeys
  const detected_agents_all = isOwn ? [...detectedSet].sort() : []
  const shown_agents = isOwn ? shownAgentsRaw : null
  const socials = authorUserId
    ? await userSocialLinksPrisma(prisma, authorUserId)
    : { github: null, twitter: null }
  if (author.x_handle) socials.twitter = author.x_handle

  return {
    id: author.id,
    name: author.name,
    avatar_url: author.avatar_url,
    bio: author.bio,
    profile_url: author.profile_url,
    created_at: author.created_at,
    kind: org ? 'team' : 'user',
    is_mirror: isMirror,
    mirror_source_url: isMirror ? author.mirror_source_url : null,
    mirror_license: mirrorLicense,
    source_owner_id: sourceOwnerId,
    source_owner_type: isMirror
      ? normalizeSourceOwnerType(author.source_owner_type)
      : null,
    total_installs,
    followers: await getFollowerCountPrisma(prisma, 'author', author.id),
    following: authorUserId
      ? await getFollowingCountPrisma(prisma, authorUserId)
      : 0,
    followed_by_me:
      callerUserId != null && callerUserId !== ''
        ? await isFollowingPrisma(prisma, callerUserId, 'author', author.id)
        : false,
    followed_by_you: [],
    followed_by_you_count: 0,
    skills,
    teams,
    members,
    kits,
    subscribed_kits,
    subscribed_author_kits,
    saved_skills,
    detected_runtimes,
    runtimes,
    detected_agents_all,
    shown_agents,
    agents_public: agentsPublic,
    socials,
  }
}
