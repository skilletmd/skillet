// Kit create / read helpers for the MySQL/Prisma path (U4).
import type { PrismaClient } from '@prisma/client'
import type { PrismaDb } from '../db/prisma-client.js'
import { newId } from '../db/index.js'
import {
  getOrgBySlugPrisma,
  isOrgMemberPrisma,
} from './org-access.js'
import {
  hasUnpublishedChangesPrisma,
  unpublishedKitDiffPrisma,
} from './kit-mutations.js'

export interface KitOwnerRowPrisma {
  id: string
  owner_id: string
  visibility: string
}

export interface CreateKitPrismaInput {
  id: string
  ownerId: string
  name: string
  slug: string
  description: string | null
  visibility: 'private' | 'public'
  sourceType: string
  sourceRepo: string | null
  sourceRef: string | null
  sourcePath: string | null
  lastSyncedSha: string | null
}

export async function resolveKitByHandlePrisma(
  prisma: PrismaDb,
  owner: string,
  slug: string,
): Promise<string | null> {
  const live = await prisma.kits.findFirst({
    where: { owner_id: owner, slug },
    select: { id: true },
  })
  if (live) return live.id
  const alias = await prisma.kit_slug_aliases.findUnique({
    where: { owner_id_slug: { owner_id: owner, slug } },
    select: { kit_id: true },
  })
  return alias?.kit_id ?? null
}

export async function findKitBySourceRepoPrisma(
  prisma: PrismaDb,
  ownerId: string,
  sourceRepo: string,
  sourceType: string,
): Promise<string | null> {
  const row = await prisma.kits.findFirst({
    where: { owner_id: ownerId, source_repo: sourceRepo, source_type: sourceType },
    select: { id: true },
  })
  return row?.id ?? null
}

export async function kitNameTakenPrisma(
  prisma: PrismaDb,
  ownerId: string,
  slug: string,
  name: string,
): Promise<boolean> {
  const bySlug = await prisma.kits.findFirst({
    where: { owner_id: ownerId, slug },
    select: { id: true },
  })
  if (bySlug) return true
  const byName = await prisma.kits.findFirst({
    where: { owner_id: ownerId, name: { equals: name } },
    select: { id: true },
  })
  return byName != null
}

export async function authorExistsPrisma(prisma: PrismaDb, authorId: string): Promise<boolean> {
  const row = await prisma.authors.findUnique({
    where: { id: authorId },
    select: { id: true },
  })
  return row != null
}

/**
 * The caller's auto-provisioned "Saved" kit — one per owner, private by default.
 * Mirrors {@link getOrCreateSavedKit} for the Prisma/MySQL path.
 */
export async function getOrCreateSavedKitPrisma(
  prisma: PrismaDb,
  ownerHandle: string,
): Promise<string> {
  const existing = await prisma.kits.findFirst({
    where: { owner_id: ownerHandle, kind: 'saved' },
    select: { id: true },
  })
  if (existing) return existing.id

  const id = newId()
  await prisma.kits.create({
    data: {
      id,
      owner_id: ownerHandle,
      name: 'Saved',
      slug: 'saved',
      description: 'Skills you added individually.',
      visibility: 'private',
      source_type: 'owned',
      kind: 'saved',
    },
  })
  return id
}

export async function createKitPrisma(
  prisma: PrismaClient,
  input: CreateKitPrismaInput,
): Promise<void> {
  await prisma.kits.create({
    data: {
      id: input.id,
      owner_id: input.ownerId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      visibility: input.visibility,
      source_type: input.sourceType,
      source_repo: input.sourceRepo,
      source_ref: input.sourceRef,
      source_path: input.sourcePath,
      last_synced_sha: input.lastSyncedSha,
    },
  })
}

export async function kitOwnerRowPrisma(
  prisma: PrismaDb,
  kitId: string,
): Promise<KitOwnerRowPrisma | null> {
  return prisma.kits.findUnique({
    where: { id: kitId },
    select: { id: true, owner_id: true, visibility: true },
  })
}

export async function isKitMemberPrisma(
  prisma: PrismaDb,
  kitId: string,
  userId: string,
): Promise<boolean> {
  const row = await prisma.kit_members.findUnique({
    where: { kit_id_user_id: { kit_id: kitId, user_id: userId } },
    select: { kit_id: true },
  })
  return row != null
}

interface KitPrincipal {
  class: string
  user_id?: string | null
  handle?: string | null
  kit_id?: string
}

/** Prisma counterpart of canReadKit in routes/kits.ts. */
export async function canReadKitPrisma(
  prisma: PrismaDb,
  kitRow: KitOwnerRowPrisma,
  principal: KitPrincipal | null | undefined,
): Promise<boolean> {
  if (kitRow.visibility === 'public') return true
  if (!principal) return false
  if (principal.class === 'kit') return principal.kit_id === kitRow.id

  const org = await getOrgBySlugPrisma(prisma, kitRow.owner_id)
  if (principal.class === 'session' && principal.user_id) {
    if (org) {
      if (await isOrgMemberPrisma(prisma, org.id, principal.user_id, org.owner_user_id)) {
        return true
      }
    } else if (principal.handle && kitRow.owner_id === principal.handle) {
      return true
    }
    if (await isKitMemberPrisma(prisma, kitRow.id, principal.user_id)) return true
    const sub = await prisma.kit_subscriptions.findFirst({
      where: {
        user_id: principal.user_id,
        kind: 'kit',
        kit_id: kitRow.id,
      },
      select: { id: true },
    })
    if (sub) return true
  }
  if (principal.class === 'device' && principal.user_id) {
    if (org) {
      if (await isOrgMemberPrisma(prisma, org.id, principal.user_id, org.owner_user_id)) {
        return true
      }
    } else {
      const u = await prisma.users.findUnique({
        where: { id: principal.user_id },
        select: { handle: true },
      })
      if (u?.handle && kitRow.owner_id === u.handle) return true
    }
    if (await isKitMemberPrisma(prisma, kitRow.id, principal.user_id)) return true
  }
  return false
}

/** Draft-oriented kit payload used by create + owner manage views. */
export async function getKitPayloadPrisma(
  prisma: PrismaDb,
  kitId: string,
  opts: { draft?: boolean } = {},
): Promise<object | null> {
  const draft = opts.draft ?? false
  const kit = await prisma.kits.findUnique({
    where: { id: kitId },
    select: {
      id: true,
      owner_id: true,
      name: true,
      slug: true,
      description: true,
      visibility: true,
      profile_hidden: true,
      created_at: true,
      source_type: true,
      source_repo: true,
      source_ref: true,
      source_path: true,
      last_synced_sha: true,
      kind: true,
    },
  })
  if (!kit) return null

  const versionAgg = await prisma.kit_versions.aggregate({
    where: { kit_id: kitId },
    _max: { version: true },
  })
  const currentVersion = versionAgg._max.version ?? 0
  const latestMeta = await prisma.kit_versions.findFirst({
    where: { kit_id: kitId },
    orderBy: { version: 'desc' },
    select: { major: true, minor: true, snapshot_json: true },
  })

  let skills: Array<{
    skill_id: string
    pinned_hash: string | null
    latest_hash: string | null
    added_at: number
    description: string | null
    visibility: string
    install_count: number
    category: string | null
  }> = []

  if (draft || currentVersion === 0) {
    const rows = await prisma.kit_skills.findMany({
      where: { kit_id: kitId },
      orderBy: { added_at: 'asc' },
      select: {
        skill_id: true,
        pinned_hash: true,
        added_at: true,
        skills: {
          select: {
            latest_hash: true,
            description: true,
            visibility: true,
            install_count: true,
            category: true,
          },
        },
      },
    })
    skills = rows.map((r) => ({
      skill_id: r.skill_id,
      pinned_hash: r.pinned_hash,
      latest_hash: r.skills.latest_hash,
      added_at: r.added_at,
      description: r.skills.description,
      visibility: r.skills.visibility,
      install_count: r.skills.install_count,
      category: r.skills.category,
    }))
  } else if (latestMeta) {
    try {
      const snap = JSON.parse(latestMeta.snapshot_json) as {
        skills?: Array<{ skill_id: string; pinned_hash: string | null }>
      }
      for (const sk of snap.skills ?? []) {
        const live = await prisma.skills.findUnique({
          where: { id: sk.skill_id },
          select: {
            latest_hash: true,
            description: true,
            visibility: true,
            install_count: true,
            category: true,
          },
        })
        if (!live) continue
        skills.push({
          skill_id: sk.skill_id,
          pinned_hash: sk.pinned_hash,
          latest_hash: live.latest_hash,
          added_at: 0,
          description: live.description,
          visibility: live.visibility,
          install_count: live.install_count,
          category: live.category,
        })
      }
    } catch {
      skills = []
    }
  }

  const lastUpdatedAgg = await prisma.skill_versions.aggregate({
    where: {
      skill_id: { in: skills.map((s) => s.skill_id) },
    },
    _max: { published_at: true },
  })

  // Skill author avatar/name for the kit page rows (skill_id is `author:slug`).
  const authorHandles = [...new Set(skills.map((s) => s.skill_id.split(':')[0]))]
  const authorRows =
    authorHandles.length > 0
      ? await prisma.authors.findMany({
          where: { id: { in: authorHandles } },
          select: { id: true, name: true, avatar_url: true },
        })
      : []
  const authorById = new Map(authorRows.map((a) => [a.id, a]))

  const subscriberCount = await prisma.kit_subscriptions.count({
    where: { kit_id: kitId, kind: 'kit' },
  })

  // Context-weight metering: kit totals are a SUM over member versions —
  // headline (token_count) and standing (token_ambient, the always-on tax if
  // every skill is hot). Omitted entirely when no member carries token data
  // (legacy kits not yet backfilled) so the UI shows nothing rather than 0.
  const memberHashes = skills
    .map((s) => ({ skill_id: s.skill_id, hash: s.pinned_hash ?? s.latest_hash }))
    .filter((m): m is { skill_id: string; hash: string } => m.hash != null)
  const tokenRows = memberHashes.length
    ? await prisma.skill_versions.findMany({
        where: { OR: memberHashes.map((m) => ({ skill_id: m.skill_id, hash: m.hash })) },
        select: { token_count: true, token_ambient: true },
      })
    : []
  let kitTokenCount = 0
  let kitTokenAmbient = 0
  let coveredMembers = 0
  for (const r of tokenRows) {
    // Accumulate both totals under one guard so they always describe the same
    // member set (a member with token_count also contributes its ambient).
    if (r.token_count != null) {
      kitTokenCount += r.token_count
      kitTokenAmbient += r.token_ambient ?? 0
      coveredMembers += 1
    }
  }
  // Emit totals only when EVERY member's current version carries a count. A
  // partial sum (mid-backfill, or a member whose SKILL.md blob was missing)
  // would read as the kit's full context cost while silently undercounting.
  const fullyCovered = memberHashes.length > 0 && coveredMembers === memberHashes.length

  return {
    id: kit.id,
    owner: kit.owner_id,
    name: kit.name,
    slug: kit.slug,
    description: kit.description,
    visibility: kit.visibility,
    kind: kit.kind,
    last_updated: lastUpdatedAgg._max.published_at ?? null,
    source_type: kit.source_type,
    source: kit.source_repo
      ? {
          repo: kit.source_repo,
          ref: kit.source_ref,
          path: kit.source_path,
          last_synced_sha: kit.last_synced_sha,
        }
      : null,
    profile_hidden: !!kit.profile_hidden,
    created_at: kit.created_at,
    version: currentVersion,
    version_label: latestMeta ? `${latestMeta.major}.${latestMeta.minor}` : '0',
    has_unpublished_changes: draft
      ? await hasUnpublishedChangesPrisma(prisma, kitId)
      : false,
    unpublished_diff: draft ? await unpublishedKitDiffPrisma(prisma, kitId) : null,
    subscriber_count: subscriberCount,
    ...(fullyCovered
      ? { kit_token_count: kitTokenCount, kit_token_ambient: kitTokenAmbient }
      : {}),
    skills: skills.map((s) => {
      const author = authorById.get(s.skill_id.split(':')[0])
      return {
        skill_id: s.skill_id,
        pinned_hash: s.pinned_hash,
        current_hash: s.pinned_hash ?? s.latest_hash,
        added_at: s.added_at,
        description: s.description,
        visibility: s.visibility,
        install_count: s.install_count,
        category: s.category,
        author_name: author?.name ?? null,
        author_avatar_url: author?.avatar_url ?? null,
      }
    }),
  }
}
