// Notification events — the inverse of the feed. Mirrors registry-feed-types.ts
// / registry-feed-mapper.ts: a typed view plus a snake_case → camelCase mapper.

export interface NotificationKit {
  kitId: string
  name: string
  owner: string
  href: string
  skillCount: number
  description: string | null
  /** The public members' categories, in member order — see FeedSubscribeEvent's
   *  skillCategories. Without them the card paints different art than the kit page. */
  skillCategories?: (string | null)[]
}

export interface NotificationSkill {
  skillId: string
  slug: string
  author: string
  category: string | null
  href: string
}

export type NotificationEvent =
  | { kind: 'followed_you'; actor: string; actorAvatarUrl: string | null; at: number }
  | {
      kind: 'subscribed_kit'
      actor: string
      actorAvatarUrl: string | null
      at: number
      kit: NotificationKit
    }
  | { kind: 'subscribed_author'; actor: string; actorAvatarUrl: string | null; at: number }
  | {
      kind: 'installed_skill'
      actor: string
      actorAvatarUrl: string | null
      at: number
      skill: NotificationSkill
    }
  // Someone proposed a change to a skill you own or admin. The skill href points
  // at the review surface.
  | {
      kind: 'proposal_received'
      actor: string
      actorAvatarUrl: string | null
      at: number
      skill: NotificationSkill
    }
  // System event (no actor): a published version of yours was blocked by the
  // scanner and pulled from installs.
  | { kind: 'version_blocked'; at: number; reason: string; skill: NotificationSkill }
  // System event (no facepile): someone invited you to their team. Carries the
  // accept target so the row can link straight to the accept page.
  | {
      kind: 'org_invited'
      at: number
      inviteId: string
      role: string
      org: { slug: string; name: string }
      inviter: string
    }

export interface NotificationsResult {
  events: NotificationEvent[]
  unreadCount: number
}

export interface NotificationEventResponse {
  kind?: string
  /** Absent on system events (e.g. version_blocked). */
  actor?: string
  actor_avatar?: string | null
  at: number
  reason?: string
  /** org_invited only. */
  invite_id?: string
  role?: string
  org?: { slug: string; name: string }
  inviter?: string
  kit?: {
    kit_id: string
    name: string
    owner: string
    href: string
    skill_count?: number
    description?: string | null
    skill_categories?: (string | null)[]
  }
  skill?: {
    skill_id: string
    slug: string
    author: string
    category?: string | null
    href: string
  }
}

export function mapNotificationEvents(
  raw: NotificationEventResponse[] | undefined,
): NotificationEvent[] {
  return (raw ?? []).flatMap((e): NotificationEvent[] => {
    if (e.kind === 'version_blocked' && e.skill) {
      return [
        {
          kind: 'version_blocked',
          at: e.at,
          reason: e.reason ?? 'quarantined',
          skill: {
            skillId: e.skill.skill_id,
            slug: e.skill.slug,
            author: e.skill.author,
            category: e.skill.category ?? null,
            href: e.skill.href,
          },
        },
      ]
    }
    const base = { actor: e.actor ?? '', actorAvatarUrl: e.actor_avatar ?? null, at: e.at }
    if (e.kind === 'subscribed_kit' && e.kit) {
      return [
        {
          kind: 'subscribed_kit',
          ...base,
          kit: {
            kitId: e.kit.kit_id,
            name: e.kit.name,
            owner: e.kit.owner,
            href: e.kit.href,
            skillCount: e.kit.skill_count ?? 0,
            description: e.kit.description ?? null,
            skillCategories: e.kit.skill_categories ?? [],
          },
        },
      ]
    }
    if ((e.kind === 'installed_skill' || e.kind === 'proposal_received') && e.skill) {
      return [
        {
          kind: e.kind,
          ...base,
          skill: {
            skillId: e.skill.skill_id,
            slug: e.skill.slug,
            author: e.skill.author,
            category: e.skill.category ?? null,
            href: e.skill.href,
          },
        },
      ]
    }
    if (e.kind === 'org_invited' && e.invite_id && e.org) {
      return [
        {
          kind: 'org_invited',
          at: e.at,
          inviteId: e.invite_id,
          role: e.role ?? 'member',
          org: { slug: e.org.slug, name: e.org.name },
          inviter: e.inviter ?? '',
        },
      ]
    }
    if (e.kind === 'followed_you') return [{ kind: 'followed_you', ...base }]
    if (e.kind === 'subscribed_author') return [{ kind: 'subscribed_author', ...base }]
    return []
  })
}
