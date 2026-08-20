/**
 * Prisma async counterparts of the pending-target resolution in approvals.ts.
 * We mirror the sync manifest priority: owned kits, member kits, subscriptions.
 */
import { toSkillId, type SkillId } from '@skillet/protocol/skill-id'
import type { PrismaDb } from '../db/prisma-client.js'
import type { PendingTarget, PendingSourceKit } from '../routes/approvals.js'

interface SyncableSkillRow {
  skill_id: string
  author_id: string
  slug: string
  latest_hash: string | null
  pinned_hash: string | null
  /** The kit this skill syncs through, for grouping the Updates page. null for
   *  a non-kit source (author subscription). */
  source_kit: PendingSourceKit | null
}

async function userHandle(prisma: PrismaDb, userId: string): Promise<string | null> {
  const row = await prisma.users.findUnique({
    where: { id: userId },
    select: { handle: true },
  })
  return row?.handle ?? null
}

/** Kit ids the user has muted (opted out of team-kit auto-sync). Shared by the
 *  pending source and the manifest source so a muted kit drops from both — and
 *  from the /approvals coverage set — together. */
export async function mutedTeamKitIdsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<Set<string>> {
  const rows = await prisma.muted_team_kits.findMany({
    where: { user_id: userId },
    select: { kit_id: true },
  })
  return new Set(rows.map((r) => r.kit_id))
}

async function ownedAndMemberKitRowsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<SyncableSkillRow[]> {
  const handle = await userHandle(prisma, userId)
  const owned: SyncableSkillRow[] = []
  if (handle) {
    const kits = await prisma.kits.findMany({
      where: { owner_id: handle },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        name: true,
        owner_id: true,
        slug: true,
        kind: true,
        authors: { select: { avatar_url: true } },
        kit_skills: {
          orderBy: { added_at: 'asc' },
          select: {
            pinned_hash: true,
            skills: {
              select: {
                id: true,
                author_id: true,
                slug: true,
                latest_hash: true,
              },
            },
          },
        },
      },
    })
    for (const kit of kits) {
      // The auto "Saved" kit is the lowest-priority source (a personal
      // catch-all), so a skill that's also in a real kit groups under that real
      // kit, not "Saved". It's handled in its own pass last — see
      // savedKitRowsPrisma / resolvedTargetsPrisma.
      if (kit.kind === 'saved') continue
      const sourceKit = kitSource(kit)
      for (const ks of kit.kit_skills) {
        if (ks.skills.author_id === handle) continue
        owned.push({
          skill_id: ks.skills.id,
          author_id: ks.skills.author_id,
          slug: ks.skills.slug,
          latest_hash: ks.skills.latest_hash,
          pinned_hash: ks.pinned_hash,
          source_kit: sourceKit,
        })
      }
    }
  }

  const member: SyncableSkillRow[] = []
  const memberships = await prisma.kit_members.findMany({
    where: { user_id: userId },
    select: {
      kits: {
        select: {
          id: true,
          name: true,
          owner_id: true,
        slug: true,
          authors: { select: { avatar_url: true } },
          created_at: true,
          kit_skills: {
            orderBy: { added_at: 'asc' },
            select: {
              pinned_hash: true,
              skills: {
                select: {
                  id: true,
                  author_id: true,
                  slug: true,
                  latest_hash: true,
                },
              },
            },
          },
        },
      },
    },
  })
  for (const m of memberships) {
    const sourceKit = kitSource(m.kits)
    for (const ks of m.kits.kit_skills) {
      if (ks.skills.author_id === (handle ?? '')) continue
      member.push({
        skill_id: ks.skills.id,
        author_id: ks.skills.author_id,
        slug: ks.skills.slug,
        latest_hash: ks.skills.latest_hash,
        pinned_hash: ks.pinned_hash,
        source_kit: sourceKit,
      })
    }
  }

  return [...owned, ...member]
}

/**
 * Kits the caller gets by being an ACCEPTED member of a team (org). Every kit the
 * org owns (`kits.owner_id = orgSlug`) syncs to its members — this is what makes
 * "publish to the team, everyone runs it" real. Attributed to the team kit so the
 * Updates page groups under "Team Kit @team". Private team kits are included
 * (members may see them); self-authored skills are excluded (self-trust).
 * Priority sits between kit-member kits and subscriptions.
 */
async function orgMemberKitRowsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<SyncableSkillRow[]> {
  const handle = await userHandle(prisma, userId)
  const memberships = await prisma.organization_members.findMany({
    where: { user_id: userId, accepted_at: { not: null } },
    select: { organizations: { select: { slug: true } } },
  })
  const muted = await mutedTeamKitIdsPrisma(prisma, userId)
  const rows: SyncableSkillRow[] = []
  for (const m of memberships) {
    const slug = m.organizations?.slug
    if (!slug) continue
    const kits = await prisma.kits.findMany({
      where: { owner_id: slug },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        name: true,
        owner_id: true,
        slug: true,
        kind: true,
        authors: { select: { avatar_url: true } },
        kit_skills: {
          orderBy: { added_at: 'asc' },
          select: {
            pinned_hash: true,
            skills: { select: { id: true, author_id: true, slug: true, latest_hash: true } },
          },
        },
      },
    })
    for (const kit of kits) {
      if (muted.has(kit.id)) continue
      const sourceKit = kitSource(kit)
      for (const ks of kit.kit_skills) {
        if (ks.skills.author_id === handle) continue
        rows.push({
          skill_id: ks.skills.id,
          author_id: ks.skills.author_id,
          slug: ks.skills.slug,
          latest_hash: ks.skills.latest_hash,
          pinned_hash: ks.pinned_hash,
          source_kit: sourceKit,
        })
      }
    }
  }
  return rows
}

/** Shape a kit row into the grouping metadata carried on each pending target.
 *  Kits have no avatar column; the cover identity is the owner author's avatar
 *  (same source the profile kit cards use). The auto "Saved" kit is displayed
 *  as "Saved" regardless of its stored name — older accounts still carry the
 *  legacy "Library" name, and the group should read as Saved either way. */
function kitSource(kit: {
  id: string
  name: string
  owner_id: string
  slug?: string | null
  kind?: string
  authors: { avatar_url: string | null } | null
}): PendingSourceKit {
  return {
    id: kit.id,
    name: kit.kind === 'saved' ? 'Saved' : kit.name,
    owner: kit.owner_id,
    slug: kit.slug ?? null,
    avatar_url: kit.authors?.avatar_url ?? null,
  }
}

/** The caller's auto "Saved" kit as syncable rows, attributed to that kit. Kept
 *  separate from ownedAndMemberKitRowsPrisma so it can be considered LAST: a
 *  skill that's also in a real kit groups under the real kit, and only
 *  saved-exclusively skills group under "Saved". */
async function savedKitRowsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<SyncableSkillRow[]> {
  const handle = await userHandle(prisma, userId)
  if (!handle) return []
  const saved = await prisma.kits.findFirst({
    where: { owner_id: handle, kind: 'saved' },
    select: {
      id: true,
      name: true,
      owner_id: true,
        slug: true,
      kind: true,
      authors: { select: { avatar_url: true } },
      kit_skills: {
        orderBy: { added_at: 'asc' },
        select: {
          pinned_hash: true,
          skills: { select: { id: true, author_id: true, slug: true, latest_hash: true } },
        },
      },
    },
  })
  if (!saved) return []
  const sourceKit = kitSource(saved)
  const rows: SyncableSkillRow[] = []
  for (const ks of saved.kit_skills) {
    if (ks.skills.author_id === handle) continue
    rows.push({
      skill_id: ks.skills.id,
      author_id: ks.skills.author_id,
      slug: ks.skills.slug,
      latest_hash: ks.skills.latest_hash,
      pinned_hash: ks.pinned_hash,
      source_kit: sourceKit,
    })
  }
  return rows
}

async function subscriptionSkillRowsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<SyncableSkillRow[]> {
  const kitSubs = await prisma.kit_subscriptions.findMany({
    where: { user_id: userId, kind: 'kit' },
    orderBy: { created_at: 'asc' },
    select: { kit_id: true },
  })

  const kitRows: SyncableSkillRow[] = []
  for (const sub of kitSubs) {
    if (!sub.kit_id) continue
    const kit = await prisma.kits.findUnique({
      where: { id: sub.kit_id },
      select: {
        id: true,
        name: true,
        owner_id: true,
        slug: true,
        authors: { select: { avatar_url: true } },
      },
    })
    if (!kit) continue
    const sourceKit = kitSource(kit)
    const ver = await prisma.kit_versions.findFirst({
      where: { kit_id: sub.kit_id },
      orderBy: { version: 'desc' },
      select: { snapshot_json: true },
    })
    if (!ver) continue

    let snapSkills: Array<{ skill_id: string; pinned_hash: string | null }> = []
    try {
      const snap = JSON.parse(ver.snapshot_json) as {
        skills?: Array<{ skill_id: string; pinned_hash: string | null }>
      }
      snapSkills = snap.skills ?? []
    } catch {
      continue
    }

    for (const sk of snapSkills) {
      const sep = sk.skill_id.indexOf(':')
      if (sep < 0) continue
      const live = await prisma.skills.findUnique({
        where: { id: sk.skill_id },
        select: { latest_hash: true, visibility: true, author_id: true, slug: true },
      })
      if (!live || live.visibility === 'private') continue
      kitRows.push({
        skill_id: sk.skill_id,
        author_id: live.author_id,
        slug: live.slug,
        latest_hash: live.latest_hash,
        pinned_hash: sk.pinned_hash ?? null,
        source_kit: sourceKit,
      })
    }
  }

  const authorSubs = await prisma.kit_subscriptions.findMany({
    where: { user_id: userId, kind: 'author' },
    orderBy: { created_at: 'asc' },
    select: { author_id: true },
  })

  const authorRows: SyncableSkillRow[] = []
  for (const sub of authorSubs) {
    if (!sub.author_id) continue
    const skills = await prisma.skills.findMany({
      where: {
        author_id: sub.author_id,
        visibility: 'public',
        latest_hash: { not: null },
      },
      orderBy: { created_at: 'asc' },
      select: { id: true, author_id: true, slug: true, latest_hash: true },
    })
    for (const s of skills) {
      authorRows.push({
        skill_id: s.id,
        author_id: s.author_id,
        slug: s.slug,
        latest_hash: s.latest_hash,
        pinned_hash: null,
        source_kit: null,
      })
    }
  }

  return [...kitRows, ...authorRows]
}

async function editedSkillIdsPrisma(prisma: PrismaDb, userId: string): Promise<Set<string>> {
  const rows = await prisma.device_skill_edits.findMany({
    where: { user_id: userId },
    select: { skill_id: true },
  })
  return new Set(rows.map((r) => r.skill_id))
}

async function isQuarantined(prisma: PrismaDb, versionHash: string): Promise<boolean> {
  const row = await prisma.skill_version_scans.findFirst({
    where: { skill_version_id: versionHash },
    select: { status: true },
  })
  return row?.status === 'quarantined'
}

/** Syncable skill targets for a user (kits + subscriptions), before edit/decision filters. */
export async function resolvedTargetsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<PendingTarget[]> {
  const seen = new Set<SkillId>()
  const out: PendingTarget[] = []

  const consider = async (r: SyncableSkillRow): Promise<void> => {
    const skillId = toSkillId(r.skill_id)
    if (seen.has(skillId)) return
    const target = r.pinned_hash ?? r.latest_hash
    if (!target) return
    if (await isQuarantined(prisma, target)) return
    seen.add(skillId)
    out.push({
      skill_id: skillId,
      author_id: r.author_id,
      slug: r.slug,
      to_hash: target,
      source_kit: r.source_kit,
    })
  }

  for (const r of await ownedAndMemberKitRowsPrisma(prisma, userId)) {
    await consider(r)
  }
  // Team (org) kits rank below your own/member kits but above subscriptions.
  for (const r of await orgMemberKitRowsPrisma(prisma, userId)) {
    await consider(r)
  }
  for (const r of await subscriptionSkillRowsPrisma(prisma, userId)) {
    await consider(r)
  }
  // Saved kit last: it only claims skills no real kit already grouped.
  for (const r of await savedKitRowsPrisma(prisma, userId)) {
    await consider(r)
  }
  return out
}

/** Skill ids the user's devices can sync (owned/member kits + subscriptions). */
export async function subscribedSkillIdsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<Set<SkillId>> {
  const ids = new Set<SkillId>()
  for (const r of await ownedAndMemberKitRowsPrisma(prisma, userId)) {
    ids.add(toSkillId(r.skill_id))
  }
  // Team-kit skills are a sync source (R3 consent coverage): the /approvals guard
  // reads this set, so a member can approve their team kits' updates.
  for (const r of await orgMemberKitRowsPrisma(prisma, userId)) {
    ids.add(toSkillId(r.skill_id))
  }
  for (const r of await subscriptionSkillRowsPrisma(prisma, userId)) {
    ids.add(toSkillId(r.skill_id))
  }
  // Saved kit is a sync source too (it's excluded from ownedAndMemberKitRows
  // for grouping priority, so add it back here for coverage).
  for (const r of await savedKitRowsPrisma(prisma, userId)) {
    ids.add(toSkillId(r.skill_id))
  }
  return ids
}

/** Prisma async counterpart of {@link pendingTargets} in approvals.ts. */
export async function pendingTargetsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<PendingTarget[]> {
  const edited = await editedSkillIdsPrisma(prisma, userId)
  const out: PendingTarget[] = []

  for (const t of await resolvedTargetsPrisma(prisma, userId)) {
    if (edited.has(t.skill_id)) continue
    const decided = await prisma.update_decisions.findFirst({
      where: {
        user_id: userId,
        skill_id: t.skill_id,
        version_hash: t.to_hash,
      },
      select: { id: true },
    })
    if (decided) continue
    out.push(t)
  }
  return out
}
