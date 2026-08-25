import type { FeedEvent, FeedSkill } from './registry-feed-types'

export interface FeedEventResponse {
  kind?: string
  type?: string
  actor: string
  actor_avatar?: string | null
  target?: string
  target_author?: {
    handle: string
    name: string
    avatar_url: string | null
    public_skills: number
    followers: number
    total_installs: number
    categories?: string[]
    top_skills: Array<{ slug: string; installs: number }>
  } | null
  actor_followers?: number
  at: number
  skill?: {
    author: string
    slug: string
    description: string | null
    category?: string | null
    installs?: number
    scan?: string | null
    version?: string | null
    /** Registry-computed semver label; absent on older registries. */
    version_label?: string | null
    followed_by_you?: string[]
    followed_by_you_count?: number
  }
  subscribe?: {
    target_kind?: string
    name: string
    owner: string
    owner_avatar_url?: string | null
    href: string
    skill_count?: number
    kit_id?: string
    description?: string | null
    subscriber_count?: number
    skill_categories?: (string | null)[]
  }
}

export interface DiscoverFeedResponse {
  events?: FeedEventResponse[]
  following_count?: number
  next_offset?: number | null
}

export function mapDiscoverFeedEvents(raw: FeedEventResponse[] | undefined): FeedEvent[] {
  const scanOf = (s?: string | null): FeedSkill['scan'] =>
    s === 'pending' || s === 'clean' || s === 'flagged' || s === 'quarantined' ? s : null
  return (raw ?? []).flatMap((e): FeedEvent[] => {
    if (e.kind === 'follow' && e.target) {
      const ta = e.target_author
      return [
        {
          kind: 'follow',
          actor: e.actor,
          actorAvatarUrl: e.actor_avatar ?? null,
          target: e.target,
          targetAuthor: ta
            ? {
                handle: ta.handle,
                name: ta.name,
                avatarUrl: ta.avatar_url ?? null,
                publicSkills: ta.public_skills,
                followers: ta.followers,
                totalInstalls: ta.total_installs,
                categories: ta.categories ?? [],
                viewerFollows: false,
                topSkills: ta.top_skills ?? [],
              }
            : null,
          at: e.at,
        },
      ]
    }
    if (e.kind === 'subscribe' && e.subscribe) {
      return [
        {
          kind: 'subscribe',
          actor: e.actor,
          actorAvatarUrl: e.actor_avatar ?? null,
          at: e.at,
          target: {
            kind: e.subscribe.target_kind === 'author' ? 'author' : 'kit',
            name: e.subscribe.name,
            owner: e.subscribe.owner,
            ownerAvatarUrl: e.subscribe.owner_avatar_url ?? null,
            href: e.subscribe.href,
            skillCount: e.subscribe.skill_count ?? 0,
            kitId: e.subscribe.kit_id,
            description: e.subscribe.description ?? null,
            subscriberCount: e.subscribe.subscriber_count ?? 0,
            skillCategories: e.subscribe.skill_categories ?? [],
          },
        },
      ]
    }
    if (e.skill) {
      return [
        {
          kind: 'skill',
          type: e.type === 'updated' ? 'updated' : 'published',
          actor: e.actor,
          actorAvatarUrl: e.actor_avatar ?? null,
          actorFollowers: e.actor_followers ?? 0,
          at: e.at,
          skill: {
            author: e.skill.author,
            slug: e.skill.slug,
            description: e.skill.description,
            category: e.skill.category ?? null,
            installs: e.skill.installs ?? 0,
            scan: scanOf(e.skill.scan),
            version: e.skill.version_label ?? e.skill.version ?? null,
            followedByYou: e.skill.followed_by_you ?? [],
            followedByYouCount: e.skill.followed_by_you_count ?? 0,
          },
        },
      ]
    }
    return []
  })
}
