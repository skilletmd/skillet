export interface FeedSkill {
  author: string
  slug: string
  description: string | null
  category: string | null
  installs: number
  scan: 'pending' | 'clean' | 'flagged' | 'quarantined' | null
  version: string | null
  followedByYou: string[]
  followedByYouCount: number
}

export interface FeedSkillEvent {
  kind: 'skill'
  type: 'published' | 'updated'
  actor: string
  actorAvatarUrl: string | null
  actorFollowers: number
  at: number
  skill: FeedSkill
}

export interface FeedFollowTarget {
  handle: string
  name: string
  avatarUrl: string | null
  publicSkills: number
  followers: number
  totalInstalls: number
  categories: string[]
  viewerFollows: boolean
  topSkills: Array<{ slug: string; installs: number }>
}

export interface FeedFollowEvent {
  kind: 'follow'
  actor: string
  actorAvatarUrl: string | null
  target: string
  targetAuthor: FeedFollowTarget | null
  at: number
}

export interface FeedSubscribeEvent {
  kind: 'subscribe'
  actor: string
  actorAvatarUrl: string | null
  at: number
  target: {
    kind: 'author' | 'kit'
    name: string
    owner: string
    href: string
    skillCount: number
    /** Kit-only — powers the rich hover preview. */
    kitId?: string
    description?: string | null
    subscriberCount?: number
    /** Kit-only — the public members' categories, in member order. The cover is a
     *  function of (seed, categories), so a card rendered without them fabricates
     *  categories from the seed and paints different art than the kit page. */
    skillCategories?: (string | null)[]
  }
}

export type FeedEvent = FeedSkillEvent | FeedFollowEvent | FeedSubscribeEvent

export type FeedView = 'following' | 'discover' | 'team'

export interface FeedResult {
  events: FeedEvent[]
  followingCount: number
  view: FeedView
  /** Continuation token for the next page — an offset to pass back, or null when
   *  the stream is exhausted. Drives the feed's infinite scroll. */
  nextCursor: number | null
}

export interface FollowSuggestion {
  handle: string
  name: string
  avatarUrl: string | null
  skills: number
  followers: number
}
