// Profile GET helpers for the MySQL/Prisma path (U4).
import type { PrismaDb } from '../db/prisma-client.js'
import { isHandleSuspendedPrisma, suspendedAuthorHandlesPrisma } from './suspension.js'
import { handleReachPrisma, summonCountsBySkillPrisma } from './summon-events.js'

interface ProfileAuthorRow {
  id: string
  name: string
  avatar_url: string | null
  bio: string | null
  profile_url: string | null
  x_handle: string | null
  created_at: number
  is_mirror: number
  mirror_source_url: string | null
  mirror_claimed_at: number | null
  source_owner_type: string | null
  agents_public: number
  shown_agents: string | null
}

function normalizeSourceOwnerType(
  raw: string | null,
): 'User' | 'Organization' | null {
  if (raw === 'User' || raw === 'Organization') return raw
  return null
}

/** Distinct external adopters of an author's public work (kit saves + subs). */
export async function countSkillAdoptersPrisma(
  prisma: PrismaDb,
  authorHandle: string,
): Promise<number> {
  return (await adopterHandlesPrisma(prisma, authorHandle)).size
}

export interface AdopterEntryPrisma {
  handle: string
  name: string | null
  avatar_url: string | null
  bio: string | null
}

/** Prisma counterpart of {@link listSkillAdopters}. */
export async function listSkillAdoptersPrisma(
  prisma: PrismaDb,
  authorHandle: string,
): Promise<AdopterEntryPrisma[]> {
  const handles = [...(await adopterHandlesPrisma(prisma, authorHandle))].sort()
  if (handles.length === 0) return []
  const authors = await prisma.authors.findMany({
    where: { id: { in: handles } },
    select: { id: true, name: true, avatar_url: true, bio: true },
  })
  const byId = new Map(authors.map((a) => [a.id, a]))
  return handles.map((handle) => {
    const a = byId.get(handle)
    return {
      handle,
      name: a?.name ?? null,
      avatar_url: a?.avatar_url ?? null,
      bio: a?.bio ?? null,
    }
  })
}

async function adopterHandlesPrisma(
  prisma: PrismaDb,
  authorHandle: string,
): Promise<Set<string>> {
  const suspended = new Set(await suspendedAuthorHandlesPrisma(prisma))
  const publicSkills = await prisma.skills.findMany({
    where: {
      author_id: authorHandle,
      visibility: 'public',
      moderation_status: { not: 'unlisted' },
    },
    select: { id: true },
  })
  const skillIds = publicSkills.map((s) => s.id)
  const handles = new Set<string>()

  if (skillIds.length > 0) {
    const kitSkills = await prisma.kit_skills.findMany({
      where: { skill_id: { in: skillIds } },
      select: {
        kits: { select: { owner_id: true, visibility: true, kind: true } },
      },
    })
    for (const ks of kitSkills) {
      if (ks.kits.visibility === 'public' || ks.kits.kind === 'saved') {
        handles.add(ks.kits.owner_id)
      }
    }
  }

  const authorKits = await prisma.kits.findMany({
    where: { owner_id: authorHandle, visibility: 'public' },
    select: { id: true },
  })
  if (authorKits.length > 0) {
    const subs = await prisma.kit_subscriptions.findMany({
      where: {
        kind: 'kit',
        kit_id: { in: authorKits.map((k) => k.id) },
      },
      select: { users: { select: { handle: true } } },
    })
    for (const sub of subs) {
      if (sub.users.handle) handles.add(sub.users.handle)
    }
  }

  handles.delete(authorHandle)
  for (const h of suspended) handles.delete(h)
  return handles
}

/** Prisma counterpart of getProfile in routes/profiles.ts. */
export async function getProfilePrisma(
  prisma: PrismaDb,
  authorId: string,
  callerHandle?: string | null,
): Promise<object | null> {
  const author = (await prisma.authors.findUnique({
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
  })) as ProfileAuthorRow | null
  if (!author) return null

  if (callerHandle !== authorId && (await isHandleSuspendedPrisma(prisma, authorId))) {
    return null
  }

  const isMirror = author.is_mirror === 1 && author.mirror_claimed_at == null
  let mirrorLicense: string | null = null
  let sourceOwnerId: number | null = null
  if (isMirror) {
    const mirror = await prisma.skill_mirrors.findFirst({
      where: { skill_id: { startsWith: `${author.id}:` } },
      select: { license: true },
    })
    mirrorLicense = mirror?.license ?? null
    const org = await prisma.organizations.findFirst({
      where: { slug: author.id },
      select: { source_owner_id: true },
    })
    sourceOwnerId = org?.source_owner_id ?? null
  }

  const skills = await prisma.skills.findMany({
    where: {
      author_id: authorId,
      visibility: 'public',
      moderation_status: { not: 'unlisted' },
    },
    orderBy: [{ install_count: 'desc' }, { created_at: 'desc' }],
    select: {
      id: true,
      slug: true,
      latest_hash: true,
      install_count: true,
      created_at: true,
    },
  })

  const total_installs = await countSkillAdoptersPrisma(prisma, authorId)
  // Summon reach (plan 012 U7): "summoned N times" per skill + the handle total.
  const summonBySkill = await summonCountsBySkillPrisma(prisma, skills.map((s) => s.id))
  const total_summons = await handleReachPrisma(prisma, authorId)

  return {
    id: author.id,
    name: author.name,
    avatar_url: author.avatar_url,
    bio: author.bio,
    profile_url: author.profile_url,
    created_at: author.created_at,
    is_mirror: isMirror,
    mirror_source_url: isMirror ? author.mirror_source_url : null,
    mirror_license: mirrorLicense,
    source_owner_id: sourceOwnerId,
    source_owner_type: isMirror ? normalizeSourceOwnerType(author.source_owner_type) : null,
    total_installs,
    total_summons,
    skills: skills.map((s) => ({
      slug: s.slug,
      skill_id: s.id,
      latest_hash: s.latest_hash,
      install_count: s.install_count,
      summon_count: summonBySkill.get(s.id) ?? 0,
      created_at: s.created_at,
    })),
  }
}
