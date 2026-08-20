import { toSkillId, type SkillId } from '@skillet/protocol/skill-id'
import { newId } from '../db/index.js'
import type { PrismaDb } from '../db/prisma-client.js'
import type { PendingSourceKit } from '../routes/approvals.js'
import { baselineSkillDecisionPrisma } from '../routes/approvals.js'
import { mutedTeamKitIdsPrisma, subscribedSkillIdsPrisma } from './pending-update-targets.js'
import { bumpUserAttentionPrisma } from './update-decisions.js'
import { bumpUserDeviceSyncPrisma } from './device-sync-stream.js'
import { getOrCreateSavedKitPrisma } from './kit-payload.js'
import { upsertKitSkillPrisma } from './kit-mutations.js'

/**
 * Removal consent (R5): a kit author dropping a skill is a decision for the
 * subscriber, not a silent prune. "Remove" lets devices prune; "Keep" saves the
 * skill to the user's Saved kit so the manifest keeps serving it — no fork, no
 * lineage break. Devices HOLD (don't prune) skills in the pending set.
 *
 * A removal is derived, not recorded: kit membership is already versioned
 * (kit_versions snapshots), so "in an earlier snapshot of a kit you subscribe
 * to, absent from the latest" is the tombstone. The consent baseline
 * (update_decisions, add = consent) anchors WHO sees it: only users who
 * actually had the skill. Self-initiated changes never queue — your own
 * unsave/unsubscribe leaves no subscribed snapshot behind, and your own kits
 * are exempt (self-trust).
 */

export interface PendingRemoval {
  skill_id: SkillId
  /** Null when the skill row was deleted upstream (Keep unavailable). */
  author_id: string | null
  slug: string | null
  /** True when Keep can re-serve it (public skill with a live version). */
  keepable: boolean
  source_kit: PendingSourceKit
}

function snapshotIds(snapshotJson: string): string[] {
  try {
    const snap = JSON.parse(snapshotJson) as { skills?: Array<{ skill_id?: unknown }> }
    return (snap.skills ?? [])
      .map((s) => s.skill_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  } catch {
    return []
  }
}

export async function pendingRemovalsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<PendingRemoval[]> {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { handle: true },
  })
  const served = await subscribedSkillIdsPrisma(prisma, userId)

  // Every kit whose membership changes can remove skills from under this user:
  // kit subscriptions, kits they're an accepted member of, and their orgs'
  // team kits (muted ones excluded — a muted kit doesn't sync, so its
  // removals decide nothing). Shared kits snapshot on every membership
  // change (autoSnapshotSharedKitPrisma), so the same derivation covers all.
  const kitIds: string[] = []
  const pushKit = (id: string | null | undefined) => {
    if (id && !kitIds.includes(id)) kitIds.push(id)
  }
  for (const sub of await prisma.kit_subscriptions.findMany({
    where: { user_id: userId, kind: 'kit' },
    orderBy: { created_at: 'asc' },
    select: { kit_id: true },
  }))
    pushKit(sub.kit_id)
  for (const m of await prisma.kit_members.findMany({
    where: { user_id: userId, accepted_at: { not: null } },
    select: { kit_id: true },
  }))
    pushKit(m.kit_id)
  const orgs = await prisma.organization_members.findMany({
    where: { user_id: userId, accepted_at: { not: null } },
    select: { organizations: { select: { slug: true } } },
  })
  for (const m of orgs) {
    const slug = m.organizations?.slug
    if (!slug) continue
    for (const kit of await prisma.kits.findMany({
      where: { owner_id: slug },
      select: { id: true },
    }))
      pushKit(kit.id)
  }
  const muted = await mutedTeamKitIdsPrisma(prisma, userId)

  const out: PendingRemoval[] = []
  const seen = new Set<string>()
  for (const kitId of kitIds) {
    if (muted.has(kitId)) continue
    const kit = await prisma.kits.findUnique({
      where: { id: kitId },
      select: {
        id: true,
        name: true,
        owner_id: true,
        slug: true,
        kind: true,
        authors: { select: { avatar_url: true } },
      },
    })
    if (!kit) continue
    if (user?.handle && kit.owner_id === user.handle) continue // self-trust

    const versions = await prisma.kit_versions.findMany({
      where: { kit_id: kit.id },
      orderBy: { version: 'desc' },
      select: { snapshot_json: true, editor_id: true },
    })
    if (versions.length < 2) continue
    const latest = new Set(snapshotIds(versions[0].snapshot_json))
    const earlier = new Set<string>()
    for (const v of versions.slice(1)) for (const id of snapshotIds(v.snapshot_json)) earlier.add(id)

    for (const removedId of earlier) {
      if (latest.has(removedId) || seen.has(removedId)) continue
      // Editor exemption: whoever made the removing edit acted deliberately —
      // their own devices prune silently, mirroring self-owned kits. The
      // removing version is the newest one BELOW which the skill still
      // appears (versions are newest-first).
      const newestContaining = versions.findIndex((v) => snapshotIds(v.snapshot_json).includes(removedId))
      const removingEditor = newestContaining > 0 ? versions[newestContaining - 1]!.editor_id : null
      if (user?.handle && removingEditor === user.handle) continue
      let skillId: SkillId
      try {
        skillId = toSkillId(removedId)
      } catch {
        continue
      }
      if (served.has(skillId)) continue // another source still serves it
      // Consent anchor: only a user who had the skill (approved baseline or
      // update) is asked about losing it. A later subscriber never sees it.
      const baseline = await prisma.update_decisions.findFirst({
        where: { user_id: userId, skill_id: removedId, state: 'approved' },
        select: { id: true },
      })
      if (!baseline) continue
      const decided = await prisma.removal_decisions.findFirst({
        where: { user_id: userId, skill_id: removedId, kit_id: kit.id },
        select: { id: true },
      })
      if (decided) continue

      const live = await prisma.skills.findUnique({
        where: { id: removedId },
        select: { author_id: true, slug: true, visibility: true, latest_hash: true },
      })
      seen.add(removedId)
      out.push({
        skill_id: skillId,
        author_id: live?.author_id ?? null,
        slug: live?.slug ?? null,
        keepable: live != null && live.visibility === 'public' && live.latest_hash != null,
        source_kit: {
          id: kit.id,
          name: kit.kind === 'saved' ? 'Saved' : kit.name,
          owner: kit.owner_id,
          slug: kit.slug ?? null,
          avatar_url: kit.authors?.avatar_url ?? null,
        },
      })
    }
  }
  return out
}

export type RemovalDecisionResult = 'ok' | 'not_pending' | 'not_keepable'

/**
 * Record a removal decision. Scope guard mirrors /approvals: the (skill, kit)
 * pair must be currently pending for this user — anything else is
 * 'not_pending'. Keep re-serves via the Saved kit and baselines the current
 * version (add = consent), so devices simply keep syncing it; Remove releases
 * the device-side hold and the next sync prunes to Trash.
 */
export async function decideRemovalPrisma(
  prisma: PrismaDb,
  userId: string,
  skillIdRaw: string,
  kitId: string,
  action: 'remove' | 'keep',
): Promise<RemovalDecisionResult> {
  const pending = await pendingRemovalsPrisma(prisma, userId)
  const row = pending.find((r) => r.skill_id === skillIdRaw && r.source_kit.id === kitId)
  if (!row) return 'not_pending'

  if (action === 'keep') {
    if (!row.keepable) return 'not_keepable'
    const user = await prisma.users.findUnique({
      where: { id: userId },
      select: { handle: true },
    })
    if (!user?.handle) return 'not_keepable'
    const skill = await prisma.skills.findUnique({
      where: { id: row.skill_id },
      select: { latest_hash: true },
    })
    if (!skill?.latest_hash) return 'not_keepable'
    const savedKitId = await getOrCreateSavedKitPrisma(prisma, user.handle)
    await upsertKitSkillPrisma(prisma, savedKitId, row.skill_id, null)
    await baselineSkillDecisionPrisma(prisma, userId, row.skill_id, skill.latest_hash)
  }

  await prisma.removal_decisions.createMany({
    data: [
      {
        id: newId(),
        user_id: userId,
        skill_id: row.skill_id,
        kit_id: kitId,
        action,
      },
    ],
    skipDuplicates: true,
  })
  await bumpUserDeviceSyncPrisma(prisma, userId)
  await bumpUserAttentionPrisma(prisma, userId)
  return 'ok'
}
