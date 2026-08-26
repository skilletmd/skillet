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
    /** The owner's avatar. The row's actorAvatarUrl belongs to the subscriber,
     *  a different person, so the card byline needs its own. */
    ownerAvatarUrl: string | null
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

/**
 * Something a person said about skills, off-platform. Not a registry event, but
 * it belongs in the same stream: a feed of only our own publishes reads as a
 * changelog, and the reason to come back is what other people are saying.
 * `skills` links it into the catalog when the post resolves to something we
 * carry; `unknownSkill` names one we do not, which is honest and is also the
 * mirror-candidate queue.
 */
export interface FeedSignalEvent {
  kind: 'signal'
  /** Where it was said. */
  network: 'x' | 'hn' | 'reddit'
  actor: string
  actorName: string | null
  actorAvatarUrl: string | null
  followers: number | null
  text: string
  url: string
  score: number | null
  views: number | null
  at: number
  context: string | null
  skills: Array<{ author: string; slug: string }>
  /** `author` is the handle that holds our copy; `repoOwner` is who actually
   *  wrote it. Always credit `repoOwner` in the UI — a post about someone's
   *  plugin is about their work, not about whoever mirrored it. */
  collection: { author: string; count: number; repo?: string; repoOwner?: string } | null
  /** Every carried repo the post referenced. A roundup names many; showing one
   *  both undersells the post and picks an arbitrary winner. */
  collections?: Array<{ author: string; count: number; repo?: string; repoOwner?: string }>
  /** How many GitHub repos the post referenced in total, carried or not. */
  repoCount?: number
  unknownSkill: string | null
  /** Prefilled category for that unknown skill, so its cover matches the one it
   *  gets on import. */
  unknownCategory?: string | null
  /** `owner/repo` the post linked, when it linked one. Any repo, resolved or
   *  not: an unresolved skill with a repo is one click from `/import`. */
  repo: string | null
}

/**
 * A written story about what the ecosystem is doing, with the posts it was
 * drawn from listed underneath.
 *
 * The counterpart to a signal event. A signal is one person saying one thing;
 * a story is the editorial layer over many of them — a launch, a lab shipping
 * something, an argument the field is having. Most collected posts are not feed
 * items on their own; they are the raw material for one of these, and listing
 * them as sources is what separates reporting from an unattributed summary.
 */
export interface FeedStoryEvent {
  kind: 'story'
  id: string
  /** Story type, shown as the kicker: skills or news. */
  storyKind: string
  /** The skill a skills story is about, so the card can offer to add it. */
  subject?: {
    slug: string | null
    repo: string | null
    category: string | null
    name: string | null
  }
  headline: string
  summary: string
  at: number
  sources: Array<{
    network: 'x' | 'hn' | 'reddit' | 'web'
    handle: string
    /** What this source contributes, e.g. "Anthropic's reply". */
    label: string
    /** Reach or context, e.g. "621K views". */
    detail: string | null
    url: string
    /** Face for the source row; null falls back to a monogram. */
    avatarUrl?: string | null
  }>
}

export type FeedEvent =
  | FeedSkillEvent
  | FeedFollowEvent
  | FeedSubscribeEvent
  | FeedSignalEvent
  | FeedStoryEvent

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
