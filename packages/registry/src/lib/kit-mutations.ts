// Kit write-path helpers for the MySQL/Prisma cutover (U4).
import type { PrismaClient } from '@prisma/client'
import type { PrismaDb } from '../db/prisma-client.js'
import { newId } from '../db/index.js'
import { canManageKitPrisma, getOrgBySlugPrisma, isOrgMemberPrisma } from './org-access.js'

interface SessionPrincipal {
  user_id: string
  handle: string | null
}

interface KitSkillSnapshotRow {
  skill_id: string
  pinned_hash: string | null
  latest_hash: string | null
}

interface KitVersionMeta {
  version: number
  major: number
  minor: number
  snapshot_json: string
}

interface KitSnapshotShape {
  name: string
  description: string | null
  visibility: string
  skills: Array<{ skill_id: string; pinned_hash: string | null; current_hash?: string | null }>
}

function snapshotSkillsKey(json: string | null): string | null {
  if (json == null) return null
  try {
    const snap = JSON.parse(json) as { skills?: unknown[] }
    return JSON.stringify(snap?.skills ?? [])
  } catch {
    return null
  }
}

function snapshotSkillIds(snapshotJson: string): Set<string> {
  try {
    const snap = JSON.parse(snapshotJson) as { skills?: Array<{ skill_id?: string }> }
    return new Set((snap.skills ?? []).map((s) => s.skill_id).filter((x): x is string => !!x))
  } catch {
    return new Set()
  }
}

function parseSnapshot(json: string | null): KitSnapshotShape | null {
  if (!json) return null
  try {
    return JSON.parse(json) as KitSnapshotShape
  } catch {
    return null
  }
}

export async function isLinkedKitPrisma(prisma: PrismaDb, kitId: string): Promise<boolean> {
  const row = await prisma.kits.findUnique({
    where: { id: kitId },
    select: { source_type: true },
  })
  return row?.source_type === 'linked'
}

export async function isKitOwnerPrisma(
  prisma: PrismaDb,
  kitId: string,
  p: SessionPrincipal,
): Promise<boolean> {
  const row = await prisma.kits.findUnique({
    where: { id: kitId },
    select: { owner_id: true },
  })
  return !!row && (await canManageKitPrisma(prisma, row.owner_id, p))
}

async function kitSkillRowsPrisma(prisma: PrismaDb, kitId: string): Promise<KitSkillSnapshotRow[]> {
  const rows = await prisma.kit_skills.findMany({
    where: { kit_id: kitId },
    orderBy: { added_at: 'asc' },
    select: {
      skill_id: true,
      pinned_hash: true,
      skills: { select: { latest_hash: true } },
    },
  })
  return rows.map((r) => ({
    skill_id: r.skill_id,
    pinned_hash: r.pinned_hash,
    latest_hash: r.skills.latest_hash,
  }))
}

async function buildKitSnapshotJsonPrisma(prisma: PrismaDb, kitId: string): Promise<string | null> {
  const kit = await prisma.kits.findUnique({
    where: { id: kitId },
    select: { name: true, description: true, visibility: true },
  })
  if (!kit) return null
  const skills = (await kitSkillRowsPrisma(prisma, kitId)).map((s) => ({
    skill_id: s.skill_id,
    pinned_hash: s.pinned_hash,
    current_hash: s.pinned_hash ?? s.latest_hash,
  }))
  return JSON.stringify({
    name: kit.name,
    description: kit.description,
    visibility: kit.visibility,
    skills,
  })
}

async function latestKitVersionMetaPrisma(
  prisma: PrismaDb,
  kitId: string,
): Promise<KitVersionMeta | null> {
  return prisma.kit_versions.findFirst({
    where: { kit_id: kitId },
    orderBy: { version: 'desc' },
    select: { version: true, major: true, minor: true, snapshot_json: true },
  })
}

/** True when the live draft skill set differs from the latest published version. */
export async function hasUnpublishedChangesPrisma(
  prisma: PrismaDb,
  kitId: string,
): Promise<boolean> {
  const draftJson = await buildKitSnapshotJsonPrisma(prisma, kitId)
  const published = await latestKitVersionMetaPrisma(prisma, kitId)
  return (
    snapshotSkillsKey(draftJson) !== snapshotSkillsKey(published?.snapshot_json ?? null)
  )
}

/**
 * Skill ids added/removed vs the latest published snapshot. With no published
 * version yet, every current skill counts as added.
 */
export async function unpublishedKitDiffPrisma(
  prisma: PrismaDb,
  kitId: string,
): Promise<{ added: string[]; removed: string[] }> {
  const draft = parseSnapshot(await buildKitSnapshotJsonPrisma(prisma, kitId))
  const publishedMeta = await latestKitVersionMetaPrisma(prisma, kitId)
  const published = parseSnapshot(publishedMeta?.snapshot_json ?? null)
  const draftIds = new Set((draft?.skills ?? []).map((s) => s.skill_id))
  const publishedIds = new Set((published?.skills ?? []).map((s) => s.skill_id))
  const added = [...draftIds].filter((id) => !publishedIds.has(id))
  const removed = [...publishedIds].filter((id) => !draftIds.has(id))
  return { added, removed }
}

async function currentKitVersionPrisma(prisma: PrismaDb, kitId: string): Promise<number> {
  const agg = await prisma.kit_versions.aggregate({
    where: { kit_id: kitId },
    _max: { version: true },
  })
  return agg._max.version ?? 0
}

export async function upsertKitSkillPrisma(
  prisma: PrismaDb,
  kitId: string,
  skillId: string,
  pinHash: string | null,
): Promise<{ wasNew: boolean }> {
  const existing = await prisma.kit_skills.findUnique({
    where: { kit_id_skill_id: { kit_id: kitId, skill_id: skillId } },
    select: { skill_id: true },
  })
  await prisma.kit_skills.upsert({
    where: { kit_id_skill_id: { kit_id: kitId, skill_id: skillId } },
    create: { kit_id: kitId, skill_id: skillId, pinned_hash: pinHash },
    update: { pinned_hash: pinHash },
  })
  return { wasNew: existing == null }
}

export async function pinKitSkillPrisma(
  prisma: PrismaDb,
  kitId: string,
  skillId: string,
  pinHash: string | null,
): Promise<boolean> {
  try {
    await prisma.kit_skills.update({
      where: { kit_id_skill_id: { kit_id: kitId, skill_id: skillId } },
      data: { pinned_hash: pinHash },
    })
    return true
  } catch {
    return false
  }
}

export async function removeKitSkillPrisma(
  prisma: PrismaDb,
  kitId: string,
  skillId: string,
): Promise<boolean> {
  try {
    await prisma.kit_skills.delete({
      where: { kit_id_skill_id: { kit_id: kitId, skill_id: skillId } },
    })
    return true
  } catch {
    return false
  }
}

export async function kitHasPrivateSkillsPrisma(
  prisma: PrismaDb,
  kitId: string,
): Promise<string[]> {
  const rows = await prisma.kit_skills.findMany({
    where: { kit_id: kitId, skills: { visibility: 'private' } },
    select: { skill_id: true },
  })
  return rows.map((r) => r.skill_id)
}

export async function publishKitVersionPrisma(
  prisma: PrismaClient,
  kitId: string,
  note: string | null,
  editorId: string | null,
): Promise<{ version: number; major: number; minor: number } | null> {
  const snapshotJson = await buildKitSnapshotJsonPrisma(prisma, kitId)
  if (snapshotJson === null) return null
  const prev = await latestKitVersionMetaPrisma(prisma, kitId)
  if (prev && snapshotSkillsKey(prev.snapshot_json) === snapshotSkillsKey(snapshotJson)) {
    return null
  }

  let major: number
  let minor: number
  if (!prev) {
    major = 1
    minor = 0
  } else {
    const before = snapshotSkillIds(prev.snapshot_json)
    const after = snapshotSkillIds(snapshotJson)
    const membershipChanged =
      before.size !== after.size || [...after].some((id) => !before.has(id))
    if (membershipChanged) {
      major = prev.major + 1
      minor = 0
    } else {
      major = prev.major
      minor = prev.minor + 1
    }
  }

  const version = (await currentKitVersionPrisma(prisma, kitId)) + 1
  await prisma.kit_versions.create({
    data: {
      id: newId(),
      kit_id: kitId,
      version,
      major,
      minor,
      snapshot_json: snapshotJson,
      summary: note,
      editor_id: editorId,
    },
  })
  return { version, major, minor }
}

/**
 * Auto-publish a membership snapshot for kits that serve OTHER people live —
 * org kits and kits with accepted members. Removal consent (R5) derives from
 * kit_versions history, and live-served kits have no publish habit of their
 * own, so without this an editor's removal leaves no trail to derive a
 * decision from. Personal kits keep their deliberate draft/publish flow:
 * nothing is published for a kit only its owner syncs. No-ops (inside
 * publishKitVersionPrisma) when membership is unchanged.
 */
export async function autoSnapshotSharedKitPrisma(
  prisma: PrismaClient,
  kitId: string,
  editorHandle: string | null,
): Promise<void> {
  const kit = await prisma.kits.findUnique({
    where: { id: kitId },
    select: { org_id: true },
  })
  if (!kit) return
  const shared =
    kit.org_id != null ||
    (await prisma.kit_members.count({ where: { kit_id: kitId, accepted_at: { not: null } } })) > 0
  if (!shared) return
  await publishKitVersionPrisma(prisma, kitId, null, editorHandle)
}

export async function revertKitToPublishedPrisma(
  prisma: PrismaDb,
  kitId: string,
): Promise<boolean> {
  const prev = await latestKitVersionMetaPrisma(prisma, kitId)
  const published = parseSnapshot(prev?.snapshot_json ?? null)
  if (!published) return false

  await prisma.kit_skills.deleteMany({ where: { kit_id: kitId } })
  if ((published.skills ?? []).length > 0) {
    await prisma.kit_skills.createMany({
      data: (published.skills ?? []).map((s) => ({
        kit_id: kitId,
        skill_id: s.skill_id,
        pinned_hash: s.pinned_hash ?? null,
      })),
    })
  }
  return true
}

export async function canSubscribeToKitPrisma(
  prisma: PrismaDb,
  kit: { id: string; owner_id: string; visibility: string },
  userId: string,
): Promise<boolean> {
  if (kit.visibility === 'public') return true
  // Team kits sync to every accepted org member; let those members subscribe too.
  const org = await getOrgBySlugPrisma(prisma, kit.owner_id)
  if (org && (await isOrgMemberPrisma(prisma, org.id, userId, org.owner_user_id))) {
    return true
  }
  const member = await prisma.kit_members.findUnique({
    where: { kit_id_user_id: { kit_id: kit.id, user_id: userId } },
    select: { kit_id: true },
  })
  return member != null
}

/** Baseline versions received at kit-subscribe time so they are not pending updates. */
export async function baselineKitSubscriptionSkillsPrisma(
  prisma: PrismaDb,
  userId: string,
  kitId: string,
): Promise<number> {
  const ver = await prisma.kit_versions.findFirst({
    where: { kit_id: kitId },
    orderBy: { version: 'desc' },
    select: { snapshot_json: true },
  })
  if (!ver) return 0

  let snapSkills: Array<{ skill_id: string; pinned_hash: string | null }> = []
  try {
    const snap = JSON.parse(ver.snapshot_json) as {
      skills?: Array<{ skill_id: string; pinned_hash: string | null }>
    }
    snapSkills = snap.skills ?? []
  } catch {
    return 0
  }

  let written = 0
  const seen = new Set<string>()
  for (const sk of snapSkills) {
    if (seen.has(sk.skill_id)) continue
    seen.add(sk.skill_id)
    const live = await prisma.skills.findUnique({
      where: { id: sk.skill_id },
      select: { latest_hash: true, visibility: true },
    })
    if (!live || live.visibility === 'private') continue
    const target = sk.pinned_hash ?? live.latest_hash
    if (!target) continue
    const res = await prisma.update_decisions.createMany({
      data: [
        {
          id: newId(),
          user_id: userId,
          skill_id: sk.skill_id,
          version_hash: target,
          state: 'approved',
          source: 'auto',
        },
      ],
      skipDuplicates: true,
    })
    written += res.count
  }
  return written
}

/** Baseline public skills received at author-subscribe time (not pending updates). */
export async function baselineAuthorSubscriptionSkillsPrisma(
  prisma: PrismaDb,
  userId: string,
  authorId: string,
): Promise<number> {
  const skills = await prisma.skills.findMany({
    where: {
      author_id: authorId,
      visibility: 'public',
      latest_hash: { not: null },
    },
    select: { id: true, latest_hash: true },
  })
  let written = 0
  for (const sk of skills) {
    if (!sk.latest_hash) continue
    const res = await prisma.update_decisions.createMany({
      data: [
        {
          id: newId(),
          user_id: userId,
          skill_id: sk.id,
          version_hash: sk.latest_hash,
          state: 'approved',
          source: 'auto',
        },
      ],
      skipDuplicates: true,
    })
    written += res.count
  }
  return written
}

/**
 * Join = consent: baseline the current versions of a team's kits' skills as
 * approved for a new member, so accepting membership syncs them silently and only
 * FUTURE versions queue on /updates. Mirrors the kit-subscribe baseline. Skips the
 * member's own authored skills (self-trust). Idempotent (skipDuplicates).
 */
export async function baselineOrgMemberKitsPrisma(
  prisma: PrismaDb,
  orgId: string,
  userId: string,
): Promise<number> {
  const org = await prisma.organizations.findUnique({
    where: { id: orgId },
    select: { slug: true },
  })
  if (!org) return 0
  const user = await prisma.users.findUnique({ where: { id: userId }, select: { handle: true } })
  const handle = user?.handle ?? null
  const kits = await prisma.kits.findMany({
    where: { owner_id: org.slug },
    select: {
      kit_skills: {
        select: {
          pinned_hash: true,
          skills: { select: { id: true, author_id: true, latest_hash: true } },
        },
      },
    },
  })
  let written = 0
  const seen = new Set<string>()
  for (const kit of kits) {
    for (const ks of kit.kit_skills) {
      const skillId = ks.skills.id
      if (seen.has(skillId)) continue
      seen.add(skillId)
      if (ks.skills.author_id === handle) continue
      const target = ks.pinned_hash ?? ks.skills.latest_hash
      if (!target) continue
      const res = await prisma.update_decisions.createMany({
        data: [
          {
            id: newId(),
            user_id: userId,
            skill_id: skillId,
            version_hash: target,
            state: 'approved',
            source: 'auto',
          },
        ],
        skipDuplicates: true,
      })
      written += res.count
    }
  }
  return written
}
