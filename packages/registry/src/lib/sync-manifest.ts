/**
 * Sync manifest helpers for the MySQL/Prisma path (U4).
 * Mirrors routes/sync.ts + kit-subscriptions.subscriptionSkillRows without
 * sqlite rowid (we tiebreak same-second publishes by hash).
 */
import type { EvalStatus, SyncManifestItem } from '@skillet/protocol'
import { slugify as canonicalSlugify } from '@skillet/protocol'
import { evalStatusFromMetadataJson } from '../eval-runner.js'
import type { PrismaDb } from '../db/prisma-client.js'
import { formatVersionLabel } from '../semver-classify.js'
import { versionOrdinalPrisma } from './version-ordinal.js'
import { mutedTeamKitIdsPrisma } from './pending-update-targets.js'

export interface SyncManifestSkillRow {
  skill_id: string
  author_id: string
  slug: string
  latest_hash: string | null
  pinned_hash: string | null
  kit_id: string
  kit_owner: string
  kit_name: string
  category: string | null
  trust_mode?: 'auto' | 'gate' | null
}

function slugifyKitName(name: string): string {
  return canonicalSlugify(name, { fallback: 'kit' })
}

export async function isQuarantinedPrisma(
  prisma: PrismaDb,
  versionHash: string,
): Promise<boolean> {
  const row = await prisma.skill_version_scans.findFirst({
    where: { skill_version_id: versionHash },
    select: { status: true },
  })
  return row?.status === 'quarantined'
}

export async function lastCleanHashPrisma(
  prisma: PrismaDb,
  skillId: string,
): Promise<string | null> {
  const versions = await prisma.skill_versions.findMany({
    where: { skill_id: skillId, yanked_at: null },
    orderBy: { published_at: 'desc' },
    select: { hash: true },
  })
  if (versions.length === 0) return null
  // An admin who reviewed the quarantine and judged it a false positive — the
  // security-tooling case, where a guard and a payload contain the same strings.
  // The findings stay on the version and stay visible; this only stops the
  // quarantine from suppressing the servable hash. Without it a skill whose
  // every version is flagged has no latest_hash at all and cannot be installed.
  const skill = await prisma.skills.findUnique({
    where: { id: skillId },
    select: { scan_override_at: true },
  })
  if (skill?.scan_override_at != null) return versions[0]!.hash
  const hashes = versions.map((v) => v.hash)
  const scans = await prisma.skill_version_scans.findMany({
    where: { skill_id: skillId, skill_version_id: { in: hashes } },
    select: { skill_version_id: true, status: true },
  })
  const statusByHash = new Map(scans.map((s) => [s.skill_version_id, s.status]))
  for (const v of versions) {
    const status = statusByHash.get(v.hash)
    if (status == null || status !== 'quarantined') return v.hash
  }
  return null
}

async function rowsToItemsPrisma(
  rows: SyncManifestSkillRow[],
  seenRefs: Set<string>,
  prisma: PrismaDb,
  callerHandle: string | null,
): Promise<SyncManifestItem[]> {
  const items: SyncManifestItem[] = []
  for (const row of rows) {
    const ref = `@${row.author_id}/${row.slug}`
    if (seenRefs.has(ref)) continue

    let targetHash = row.pinned_hash ?? row.latest_hash
    if (targetHash && (await isQuarantinedPrisma(prisma, targetHash))) {
      targetHash = await lastCleanHashPrisma(prisma, row.skill_id)
    }
    if (!targetHash) continue

    const contentHash = targetHash.startsWith('sha256:') ? targetHash : `sha256:${targetHash}`
    const rawHash = targetHash.startsWith('sha256:')
      ? targetHash.slice('sha256:'.length)
      : targetHash
    seenRefs.add(ref)

    const versionRow = await prisma.skill_versions.findFirst({
      where: {
        skill_id: row.skill_id,
        OR: [{ hash: rawHash }, { hash: contentHash }],
      },
      select: {
        hash: true,
        metadata_json: true,
        major: true,
        minor: true,
        patch: true,
        token_count: true,
        token_ambient: true,
        token_method: true,
      },
    })
    const evalStatus: EvalStatus =
      versionRow && versionRow.hash === rawHash
        ? evalStatusFromMetadataJson(versionRow.metadata_json)
        : 'none'
    const skillMeta = await prisma.skills.findUnique({
      where: { id: row.skill_id },
      select: { deprecated_at: true },
    })
    const ordinal = await versionOrdinalPrisma(prisma, row.skill_id, rawHash)

    items.push({
      ref,
      version: ordinal,
      ...(versionRow ? { version_label: formatVersionLabel(versionRow) } : {}),
      content_hash: contentHash,
      signature: null,
      author_key_id: null,
      policy: row.pinned_hash ? 'pinned' : 'manual',
      source_kit: `@${row.kit_owner}/${slugifyKitName(row.kit_name)}`,
      ...(row.kit_name !== 'profile' ? { kit_id: row.kit_id } : {}),
      subscriber_trust: row.trust_mode ?? null,
      ...(row.category ? { category: row.category } : {}),
      external_author: row.author_id !== callerHandle,
      ...(evalStatus !== 'none' ? { eval: evalStatus } : {}),
      ...(skillMeta?.deprecated_at ? { deprecated: true } : {}),
      ...(versionRow?.token_count != null ? { token_count: versionRow.token_count } : {}),
      ...(versionRow?.token_ambient != null ? { token_ambient: versionRow.token_ambient } : {}),
      ...(versionRow?.token_method ? { token_method: versionRow.token_method } : {}),
    })
  }
  return items
}

function sourceKeyForRow(
  row: { kit_id: string; kit_owner: string; kit_name: string },
  callerHandle: string | null,
): string {
  if (row.kit_name === 'profile') {
    return row.kit_id === callerHandle ? 'author:self' : `author:${row.kit_owner}`
  }
  return `kit:${row.kit_id}`
}

export async function subscriptionSkillRowsPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<SyncManifestSkillRow[]> {
  const kitSubs = await prisma.kit_subscriptions.findMany({
    where: { user_id: userId, kind: 'kit' },
    orderBy: { created_at: 'asc' },
    select: {
      kit_id: true,
      trust_mode: true,
      kits: { select: { owner_id: true, name: true } },
    },
  })

  const kitRows: SyncManifestSkillRow[] = []
  for (const sub of kitSubs) {
    if (!sub.kit_id || !sub.kits) continue
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
      const author_id = sk.skill_id.slice(0, sep)
      const slug = sk.skill_id.slice(sep + 1)
      const live = await prisma.skills.findUnique({
        where: { id: sk.skill_id },
        select: { latest_hash: true, visibility: true, category: true },
      })
      if (!live || live.visibility === 'private') continue
      kitRows.push({
        skill_id: sk.skill_id,
        author_id,
        slug,
        category: live.category ?? null,
        latest_hash: live.latest_hash,
        pinned_hash: sk.pinned_hash ?? null,
        kit_id: sub.kit_id,
        kit_owner: sub.kits.owner_id,
        kit_name: sub.kits.name,
        trust_mode: (sub.trust_mode as 'auto' | 'gate' | null) ?? null,
      })
    }
  }

  const authorSubs = await prisma.kit_subscriptions.findMany({
    where: { user_id: userId, kind: 'author', author_id: { not: null } },
    orderBy: { created_at: 'asc' },
    select: { author_id: true, trust_mode: true, created_at: true },
  })

  const authorRows: SyncManifestSkillRow[] = []
  for (const sub of authorSubs) {
    if (!sub.author_id) continue
    const skills = await prisma.skills.findMany({
      where: {
        author_id: sub.author_id,
        visibility: 'public',
        latest_hash: { not: null },
      },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        author_id: true,
        slug: true,
        category: true,
        latest_hash: true,
      },
    })
    for (const s of skills) {
      authorRows.push({
        skill_id: s.id,
        author_id: s.author_id,
        slug: s.slug,
        category: s.category,
        latest_hash: s.latest_hash,
        pinned_hash: null,
        kit_id: sub.author_id,
        kit_owner: sub.author_id,
        kit_name: 'profile',
        trust_mode: (sub.trust_mode as 'auto' | 'gate' | null) ?? null,
      })
    }
  }

  return [...kitRows, ...authorRows]
}

/** Prisma counterpart of {@link buildSessionManifest} in routes/sync.ts. */
export async function buildSessionManifestPrisma(
  prisma: PrismaDb,
  userId: string,
  handle: string | null,
  excludeKeys: Set<string> = new Set(),
): Promise<SyncManifestItem[]> {
  const keep = <T extends { kit_id: string; kit_owner: string; kit_name: string }>(
    rows: T[],
  ): T[] =>
    excludeKeys.size === 0
      ? rows
      : rows.filter((r) => !excludeKeys.has(sourceKeyForRow(r, handle)))

  let ownerRows: SyncManifestSkillRow[] = []
  if (handle) {
    // The auto "Saved" kit is handled last (savedRows) so an overlapping skill
    // attributes to a real/team kit, matching the pending-queue priority.
    const kits = await prisma.kits.findMany({
      where: { owner_id: handle, kind: { not: 'saved' } },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        owner_id: true,
        name: true,
        kit_skills: {
          orderBy: { added_at: 'asc' },
          select: {
            pinned_hash: true,
            skills: {
              select: {
                id: true,
                author_id: true,
                slug: true,
                category: true,
                latest_hash: true,
              },
            },
          },
        },
      },
    })
    ownerRows = kits.flatMap((k) =>
      k.kit_skills.map((ks) => ({
        skill_id: ks.skills.id,
        author_id: ks.skills.author_id,
        slug: ks.skills.slug,
        category: ks.skills.category,
        latest_hash: ks.skills.latest_hash,
        pinned_hash: ks.pinned_hash,
        kit_id: k.id,
        kit_owner: k.owner_id,
        kit_name: k.name,
      })),
    )
  }

  const memberships = await prisma.kit_members.findMany({
    where: { user_id: userId },
    select: {
      kits: {
        select: {
          id: true,
          owner_id: true,
          name: true,
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
                  category: true,
                  latest_hash: true,
                },
              },
            },
          },
        },
      },
    },
  })
  memberships.sort((a, b) => a.kits.created_at - b.kits.created_at)
  const memberRows: SyncManifestSkillRow[] = memberships.flatMap((m) =>
    m.kits.kit_skills.map((ks) => ({
      skill_id: ks.skills.id,
      author_id: ks.skills.author_id,
      slug: ks.skills.slug,
      category: ks.skills.category,
      latest_hash: ks.skills.latest_hash,
      pinned_hash: ks.pinned_hash,
      kit_id: m.kits.id,
      kit_owner: m.kits.owner_id,
      kit_name: m.kits.name,
    })),
  )

  // Team (org) kits: every kit an org owns syncs to its accepted members, so
  // publishing to a team reaches everyone. Attributed to the team kit (kit_owner
  // is the org slug) so the Updates page groups under "Team Kit @team". Parallels
  // the org-member source in pending-update-targets — both must serve the same
  // set (consent coverage).
  const orgMemberships = await prisma.organization_members.findMany({
    where: { user_id: userId, accepted_at: { not: null } },
    select: { organizations: { select: { slug: true } } },
  })
  const mutedOrgKits = await mutedTeamKitIdsPrisma(prisma, userId)
  const orgMemberRows: SyncManifestSkillRow[] = []
  for (const om of orgMemberships) {
    const slug = om.organizations?.slug
    if (!slug) continue
    const kits = await prisma.kits.findMany({
      where: { owner_id: slug },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        owner_id: true,
        name: true,
        kit_skills: {
          orderBy: { added_at: 'asc' },
          select: {
            pinned_hash: true,
            skills: {
              select: {
                id: true,
                author_id: true,
                slug: true,
                category: true,
                latest_hash: true,
              },
            },
          },
        },
      },
    })
    for (const k of kits) {
      if (mutedOrgKits.has(k.id)) continue
      for (const ks of k.kit_skills) {
        orgMemberRows.push({
          skill_id: ks.skills.id,
          author_id: ks.skills.author_id,
          slug: ks.skills.slug,
          category: ks.skills.category,
          latest_hash: ks.skills.latest_hash,
          pinned_hash: ks.pinned_hash,
          kit_id: k.id,
          kit_owner: k.owner_id,
          kit_name: k.name,
        })
      }
    }
  }

  // The auto "Saved" kit, considered last (lowest priority) so a skill that's
  // also in a real/team kit groups under that kit, not "Saved".
  let savedRows: SyncManifestSkillRow[] = []
  if (handle) {
    const saved = await prisma.kits.findFirst({
      where: { owner_id: handle, kind: 'saved' },
      select: {
        id: true,
        owner_id: true,
        name: true,
        kit_skills: {
          orderBy: { added_at: 'asc' },
          select: {
            pinned_hash: true,
            skills: {
              select: { id: true, author_id: true, slug: true, category: true, latest_hash: true },
            },
          },
        },
      },
    })
    savedRows = (saved?.kit_skills ?? []).map((ks) => ({
      skill_id: ks.skills.id,
      author_id: ks.skills.author_id,
      slug: ks.skills.slug,
      category: ks.skills.category,
      latest_hash: ks.skills.latest_hash,
      pinned_hash: ks.pinned_hash,
      kit_id: saved!.id,
      kit_owner: saved!.owner_id,
      kit_name: saved!.name,
    }))
  }

  let ownAuthoredRows: SyncManifestSkillRow[] = []
  if (handle) {
    const skills = await prisma.skills.findMany({
      where: { author_id: handle, latest_hash: { not: null } },
      orderBy: { created_at: 'asc' },
      select: {
        id: true,
        author_id: true,
        slug: true,
        category: true,
        latest_hash: true,
      },
    })
    ownAuthoredRows = skills.map((s) => ({
      skill_id: s.id,
      author_id: s.author_id,
      slug: s.slug,
      category: s.category,
      latest_hash: s.latest_hash,
      pinned_hash: null,
      kit_id: s.author_id,
      kit_owner: s.author_id,
      kit_name: 'profile',
    }))
  }

  const seenRefs = new Set<string>()
  const ownerItems = await rowsToItemsPrisma(keep(ownerRows), seenRefs, prisma, handle)
  const memberItems = await rowsToItemsPrisma(keep(memberRows), seenRefs, prisma, handle)
  // Org kits rank below your own/member kits, above subscriptions (mirrors the
  // pending-target priority).
  const orgMemberItems = await rowsToItemsPrisma(keep(orgMemberRows), seenRefs, prisma, handle)
  const ownAuthoredItems = await rowsToItemsPrisma(
    keep(ownAuthoredRows),
    seenRefs,
    prisma,
    handle,
  )
  const subRows = await subscriptionSkillRowsPrisma(prisma, userId)
  const subItems = await rowsToItemsPrisma(keep(subRows), seenRefs, prisma, handle)
  // Saved kit last: only claims skills no real/team/subscribed kit already served.
  const savedItems = await rowsToItemsPrisma(keep(savedRows), seenRefs, prisma, handle)
  return [...ownerItems, ...memberItems, ...orgMemberItems, ...ownAuthoredItems, ...subItems, ...savedItems]
}

export async function deviceExcludeKeysPrisma(
  prisma: PrismaDb,
  deviceId: string | null,
  userId: string,
): Promise<Set<string>> {
  if (!deviceId) return new Set()
  const owned = await prisma.devices.findFirst({
    where: { id: deviceId, user_id: userId },
    select: { id: true },
  })
  if (!owned) return new Set()
  const rows = await prisma.device_kit_excludes.findMany({
    where: { device_id: deviceId },
    select: { source_key: true },
  })
  return new Set(rows.map((r) => r.source_key))
}

/** Kit-key class manifest: skills scoped to a single kit. */
export async function buildKitManifestPrisma(
  prisma: PrismaDb,
  kitId: string,
): Promise<SyncManifestItem[]> {
  const kit = await prisma.kits.findUnique({
    where: { id: kitId },
    select: { owner_id: true, name: true },
  })
  if (!kit) return []

  const members = await prisma.kit_skills.findMany({
    where: { kit_id: kitId },
    orderBy: { added_at: 'asc' },
    select: {
      pinned_hash: true,
      skills: {
        select: {
          id: true,
          author_id: true,
          slug: true,
          latest_hash: true,
          category: true,
        },
      },
    },
  })
  const rows: SyncManifestSkillRow[] = members.map((m) => ({
    skill_id: m.skills.id,
    author_id: m.skills.author_id,
    slug: m.skills.slug,
    latest_hash: m.skills.latest_hash,
    pinned_hash: m.pinned_hash,
    kit_id: kitId,
    kit_owner: kit.owner_id,
    kit_name: kit.name,
    category: m.skills.category,
    trust_mode: null,
  }))
  return rowsToItemsPrisma(rows, new Set(), prisma, kit.owner_id)
}
