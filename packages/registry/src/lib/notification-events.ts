// Inbound notification reads for the MySQL/Prisma path (U4).
// Mirrors notificationEventRows / unreadNotificationCount in routes/notifications.ts.
import type { PrismaDb } from '../db/prisma-client.js'
import type { NotificationEvent } from '../routes/notifications.js'

/** Active actor filter shared across social notification sources. */
function actorUserWhere(viewerUserId: string) {
  return {
    handle: { not: null },
    suspended_at: null,
    id: { not: viewerUserId },
  }
}

/** Batch-load author avatars for actor handles (matches attachActorAvatars). */
export async function attachActorAvatarsPrisma<T extends { actor: string }>(
  prisma: PrismaDb,
  events: T[],
): Promise<Array<T & { actor_avatar: string | null }>> {
  const out = events as Array<T & { actor_avatar: string | null }>
  const ids = [...new Set(events.map((e) => e.actor))]
  if (ids.length === 0) return out
  const rows = await prisma.authors.findMany({
    where: { id: { in: ids } },
    select: { id: true, avatar_url: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r.avatar_url]))
  for (const e of out) e.actor_avatar = byId.get(e.actor) ?? null
  return out
}

/** The viewer's author handle for the session user id, or null. */
export async function viewerHandleForUserPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<string | null> {
  const row = await prisma.users.findUnique({
    where: { id: userId },
    select: { handle: true },
  })
  return row?.handle ?? null
}

export async function notificationsSeenAtPrisma(
  prisma: PrismaDb,
  userId: string,
): Promise<number | null> {
  const row = await prisma.users.findUnique({
    where: { id: userId },
    select: { notifications_seen_at: true },
  })
  return row?.notifications_seen_at ?? null
}

/** Advance the seen cursor and bump attention_seq (SSE fan-out stays sqlite until U6). */
export async function markNotificationsSeenPrisma(prisma: PrismaDb, userId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await prisma.users.update({
    where: { id: userId },
    data: {
      notifications_seen_at: now,
      attention_seq: { increment: 1 },
    },
  })
}

async function orgInviteNotificationEventsPrisma(
  prisma: PrismaDb,
  viewerHandle: string,
  viewerUserId: string,
  limit: number,
): Promise<NotificationEvent[]> {
  const now = Math.floor(Date.now() / 1000)
  const identities = await prisma.user_identities.findMany({
    where: { user_id: viewerUserId, email: { not: null } },
    select: { email: true },
  })
  const emailSet = new Set(
    identities
      .map((row) => row.email?.toLowerCase())
      .filter((email): email is string => typeof email === 'string' && email.length > 0),
  )

  const invites = await prisma.organization_invites.findMany({
    where: {
      redeemed_at: null,
      OR: [{ expires_at: null }, { expires_at: { gt: now } }],
    },
    orderBy: { created_at: 'desc' },
    take: limit,
    select: {
      id: true,
      role: true,
      created_at: true,
      handle: true,
      email: true,
      organizations: { select: { slug: true, name: true } },
      users: { select: { handle: true } },
    },
  })

  const matched = invites.filter((invite) => {
    if (invite.handle != null && invite.handle === viewerHandle) return true
    if (invite.email != null && emailSet.has(invite.email.toLowerCase())) return true
    return false
  })

  return matched.map((invite) => ({
    kind: 'org_invited' as const,
    at: invite.created_at,
    invite_id: invite.id,
    role: invite.role,
    org: { slug: invite.organizations.slug, name: invite.organizations.name },
    inviter: invite.users.handle ?? '',
  }))
}

async function loadInstalledSkillEventsPrisma(
  prisma: PrismaDb,
  viewerHandle: string,
  viewerUserId: string,
  limit: number,
): Promise<Array<Extract<NotificationEvent, { kind: 'installed_skill' }>>> {
  const authorSkills = await prisma.skills.findMany({
    where: { author_id: viewerHandle, visibility: 'public' },
    select: { id: true, slug: true, author_id: true, category: true },
  })
  if (authorSkills.length === 0) return []
  const skillById = new Map(authorSkills.map((s) => [s.id, s]))

  const rows = await prisma.skill_installers.findMany({
    where: {
      installer_kind: 'user',
      installer_id: { not: viewerUserId },
      skill_id: { in: authorSkills.map((s) => s.id) },
    },
    orderBy: { installed_at: 'desc' },
    take: limit,
    select: { installer_id: true, installed_at: true, skill_id: true },
  })
  if (rows.length === 0) return []

  const actors = await prisma.users.findMany({
    where: {
      id: { in: [...new Set(rows.map((r) => r.installer_id))] },
      handle: { not: null },
      suspended_at: null,
    },
    select: { id: true, handle: true },
  })
  const handleById = new Map(actors.map((u) => [u.id, u.handle!]))

  const out: Array<Extract<NotificationEvent, { kind: 'installed_skill' }>> = []
  for (const row of rows) {
    const actor = handleById.get(row.installer_id)
    const skill = skillById.get(row.skill_id)
    if (!actor || !skill) continue
    out.push({
      kind: 'installed_skill',
      actor,
      at: row.installed_at,
      skill: {
        skill_id: skill.id,
        slug: skill.slug,
        author: skill.author_id,
        category: skill.category,
        href: `/${skill.author_id}/${skill.slug}`,
      },
    })
  }
  return out
}

async function loadVersionBlockedEventsPrisma(
  prisma: PrismaDb,
  viewerHandle: string,
  limit: number,
): Promise<Array<Extract<NotificationEvent, { kind: 'version_blocked' }>>> {
  const rows = await prisma.version_scan_notices.findMany({
    where: { author_id: viewerHandle },
    orderBy: { created_at: 'desc' },
    take: limit,
    select: { reason: true, created_at: true, skill_id: true },
  })
  if (rows.length === 0) return []

  const skills = await prisma.skills.findMany({
    where: { id: { in: rows.map((r) => r.skill_id) } },
    select: { id: true, slug: true, author_id: true, category: true },
  })
  const skillById = new Map(skills.map((s) => [s.id, s]))

  const out: Array<Extract<NotificationEvent, { kind: 'version_blocked' }>> = []
  for (const row of rows) {
    const skill = skillById.get(row.skill_id)
    if (!skill) continue
    out.push({
      kind: 'version_blocked',
      at: row.created_at,
      reason: row.reason,
      skill: {
        skill_id: skill.id,
        slug: skill.slug,
        author: skill.author_id,
        category: skill.category,
        href: `/${skill.author_id}/${skill.slug}`,
      },
    })
  }
  return out
}

/**
 * Inbound events targeting `viewerHandle`, newest first, capped at `limit`.
 * Mirrors {@link notificationEventRows} in routes/notifications.ts.
 */
export async function notificationEventRowsPrisma(
  prisma: PrismaDb,
  viewerHandle: string,
  viewerUserId: string,
  limit: number,
): Promise<NotificationEvent[]> {
  const actorFilter = actorUserWhere(viewerUserId)

  const [followed, kits, authors, installs, blocked, inviteEvents] = await Promise.all([
    prisma.follows.findMany({
      where: {
        subject_kind: 'author',
        subject_id: viewerHandle,
        is_private: 0,
        follower_user_id: { not: viewerUserId },
        users: actorFilter,
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: { created_at: true, users: { select: { handle: true } } },
    }),
    prisma.kit_subscriptions.findMany({
      where: {
        kind: 'kit',
        user_id: { not: viewerUserId },
        users: actorFilter,
        kits: { owner_id: viewerHandle, visibility: 'public' },
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: {
        created_at: true,
        users: { select: { handle: true } },
        kits: {
          select: {
            id: true,
            name: true,
            owner_id: true,
            description: true,
            _count: { select: { kit_skills: true } },
            // Cover categories, public members in member order — the card seeds on
            // kit_id like the detail hero, so without these it fabricates
            // categories from the seed and paints different art for the same kit.
            kit_skills: {
              where: { skills: { visibility: 'public' } },
              orderBy: { added_at: 'asc' },
              select: { skills: { select: { category: true } } },
            },
          },
        },
      },
    }),
    prisma.kit_subscriptions.findMany({
      where: {
        kind: 'author',
        author_id: viewerHandle,
        user_id: { not: viewerUserId },
        users: actorFilter,
      },
      orderBy: { created_at: 'desc' },
      take: limit,
      select: { created_at: true, users: { select: { handle: true } } },
    }),
    loadInstalledSkillEventsPrisma(prisma, viewerHandle, viewerUserId, limit),
    loadVersionBlockedEventsPrisma(prisma, viewerHandle, limit),
    orgInviteNotificationEventsPrisma(prisma, viewerHandle, viewerUserId, limit),
  ])

  const actorEvents: Array<Extract<NotificationEvent, { actor: string }>> = [
    ...followed
      .filter((r) => r.users.handle != null)
      .map((r) => ({
        kind: 'followed_you' as const,
        actor: r.users.handle!,
        at: r.created_at,
      })),
    ...kits
      .filter((r) => r.users.handle != null && r.kits != null)
      .map((r) => ({
        kind: 'subscribed_kit' as const,
        actor: r.users.handle!,
        at: r.created_at,
        kit: {
          kit_id: r.kits!.id,
          name: r.kits!.name,
          owner: r.kits!.owner_id,
          href: `/kits/${r.kits!.id}`,
          skill_count: r.kits!._count.kit_skills,
          description: r.kits!.description,
          skill_categories: r.kits!.kit_skills.map((ks) => ks.skills.category ?? null),
        },
      })),
    ...authors
      .filter((r) => r.users.handle != null)
      .map((r) => ({
        kind: 'subscribed_author' as const,
        actor: r.users.handle!,
        at: r.created_at,
      })),
    ...installs,
  ]

  const blockedEvents: NotificationEvent[] = blocked

  const events: NotificationEvent[] = [
    ...(await attachActorAvatarsPrisma(prisma, actorEvents)),
    ...blockedEvents,
    ...inviteEvents,
  ]
  events.sort((a, b) => b.at - a.at)
  return events.slice(0, limit)
}

/** Count of inbound events newer than `since` (all of them when `since` is null). */
export async function unreadNotificationCountPrisma(
  prisma: PrismaDb,
  viewerHandle: string,
  viewerUserId: string,
  since: number | null,
): Promise<number> {
  const now = Math.floor(Date.now() / 1000)
  const actorFilter = actorUserWhere(viewerUserId)
  const sinceFilter = since == null ? {} : { gt: since }

  const identities = await prisma.user_identities.findMany({
    where: { user_id: viewerUserId, email: { not: null } },
    select: { email: true },
  })
  const emails = identities
    .map((row) => row.email?.toLowerCase())
    .filter((email): email is string => typeof email === 'string' && email.length > 0)

  const inviteWhere = {
    redeemed_at: null,
    OR: [{ expires_at: null }, { expires_at: { gt: now } }],
    AND: [
      {
        OR: [
          { handle: viewerHandle },
          ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
        ],
      },
      ...(since != null ? [{ created_at: sinceFilter }] : []),
    ],
  }

  const [
    blockedCount,
    inviteCount,
    followedCount,
    kitSubCount,
    authorSubCount,
    installCount,
  ] = await Promise.all([
    prisma.version_scan_notices.count({
      where: {
        author_id: viewerHandle,
        ...(since != null ? { created_at: sinceFilter } : {}),
      },
    }),
    prisma.organization_invites.count({ where: inviteWhere }),
    prisma.follows.count({
      where: {
        subject_kind: 'author',
        subject_id: viewerHandle,
        is_private: 0,
        follower_user_id: { not: viewerUserId },
        users: actorFilter,
        ...(since != null ? { created_at: sinceFilter } : {}),
      },
    }),
    prisma.kit_subscriptions.count({
      where: {
        kind: 'kit',
        user_id: { not: viewerUserId },
        users: actorFilter,
        kits: { owner_id: viewerHandle, visibility: 'public' },
        ...(since != null ? { created_at: sinceFilter } : {}),
      },
    }),
    prisma.kit_subscriptions.count({
      where: {
        kind: 'author',
        author_id: viewerHandle,
        user_id: { not: viewerUserId },
        users: actorFilter,
        ...(since != null ? { created_at: sinceFilter } : {}),
      },
    }),
    countInstalledSkillNotificationsPrisma(
      prisma,
      viewerHandle,
      viewerUserId,
      since,
    ),
  ])

  return (
    blockedCount +
    inviteCount +
    followedCount +
    kitSubCount +
    authorSubCount +
    installCount
  )
}

async function countInstalledSkillNotificationsPrisma(
  prisma: PrismaDb,
  viewerHandle: string,
  viewerUserId: string,
  since: number | null,
): Promise<number> {
  const authorSkills = await prisma.skills.findMany({
    where: { author_id: viewerHandle, visibility: 'public' },
    select: { id: true },
  })
  if (authorSkills.length === 0) return 0

  const rows = await prisma.skill_installers.findMany({
    where: {
      installer_kind: 'user',
      installer_id: { not: viewerUserId },
      skill_id: { in: authorSkills.map((s) => s.id) },
      ...(since != null ? { installed_at: { gt: since } } : {}),
    },
    select: { installer_id: true },
  })
  if (rows.length === 0) return 0

  const validInstallerIds = new Set(
    (
      await prisma.users.findMany({
        where: {
          id: { in: [...new Set(rows.map((r) => r.installer_id))] },
          handle: { not: null },
          suspended_at: null,
        },
        select: { id: true },
      })
    ).map((u) => u.id),
  )
  return rows.filter((r) => validInstallerIds.has(r.installer_id)).length
}
