/**
 * External signal — what people are publicly saying about skills.
 *
 * The selection rule, learned the hard way: the filter is "is this post actually
 * about a skill," and registry attachment is an *enrichment* on top. Filtering on
 * attachment instead drops 99% of the good material (only ~1% of posts name a
 * skill we carry) and forces you to pad the page with topic-keyword matches —
 * generic AI commentary that happens to contain the word "design". A strict
 * about-skills filter over the same 720-post sample keeps 37 posts, ~7 a day,
 * and every one of them is worth reading.
 *
 * Enrichment tiers, and what each is allowed to claim:
 *   - `named`      — the post names a skill we carry. Link straight to it.
 *   - `collection` — the post points at a repo we mirror but names no individual
 *                    skill. Link the author's library and say how big it is;
 *                    never pick an arbitrary slug and imply precision.
 *   - `none`       — no registry match. Still a good feed item. If it names a
 *                    skill we do not carry, say so plainly — that is honest and
 *                    it is also the mirror-candidate queue in disguise.
 *
 * Today this reads a seed file from a one-off spike. The shape is the contract an
 * hourly collector writes into a `signal_mentions` table; nothing downstream
 * changes when the source does.
 *
 * Attribution rule: link and short-quote, always name the account, never rehost.
 */
import fs from 'node:fs'
import path from 'node:path'
import { guessCategory } from '@skillet/protocol'
import bundledSeed from './news-signal-seed.json'

/**
 * The collector's output, or the committed seed.
 *
 * The nightly job writes `content/news-signal.json`, which is gitignored like
 * blog.db: it is runtime state, and having it overwrite a TRACKED file meant
 * every morning's run left the deploy checkout dirty and the next `git pull`
 * either conflicted or threw the day's collection away.
 *
 * The bundled copy stays as the fallback so a fresh checkout renders a real
 * page before the first collection ever runs.
 */
function loadSeed(): typeof bundledSeed {
  try {
    const live = path.join(process.cwd(), 'content', 'news-signal.json')
    if (fs.existsSync(live)) return JSON.parse(fs.readFileSync(live, 'utf8'))
  } catch {
    // A malformed or unreadable collection costs freshness, never the page.
  }
  return bundledSeed
}

const seed = loadSeed()

export interface SignalSkillRef {
  author: string
  slug: string
}

export interface SignalItem {
  handle: string
  name: string | null
  followers: number | null
  text: string
  url: string
  likes: number | null
  views: number | null
  createdAt: string | null
  match: 'named' | 'collection' | 'none'
  skills: SignalSkillRef[]
  collection: { author: string; count: number; repo?: string; repoOwner?: string } | null
  collections?: Array<{ author: string; count: number; repo?: string; repoOwner?: string }>
  repos?: string[]
  /** A skill the post names that the registry does not carry. */
  unknownSkill: string | null
  topics: string[]
  /** Any GitHub repo the post linked, resolved or not. */
  githubRepo?: string | null
  /** Avatar from the source API; null falls back to a monogram. */
  avatarUrl?: string | null
  /** Which network the post came from. */
  source?: 'x' | 'hn' | 'reddit'
  /** Where it sat on that network: a subreddit, or the HN story it replied to. */
  context?: string | null
  /**
   * Within-source percentile, 0..1. HN points and X likes are different
   * currencies, so ranking on raw engagement would bury every HN item under
   * every tweet. Normalising inside each source first lets a 45-point Show HN
   * sit next to a 13K-like post on merit.
   */
  rank?: number
}

interface SignalSeed {
  generatedAt: string
  items: SignalItem[]
}

const signal = seed as SignalSeed

/** Ranked feed items. Already ordered by reach at build time. */
export function getSignalItems(limit?: number, topic?: string): SignalItem[] {
  const rows = topic ? signal.items.filter((i) => i.topics.includes(topic)) : signal.items
  return limit ? rows.slice(0, limit) : rows
}

export function signalGeneratedAt(): string {
  return signal.generatedAt
}

/**
 * Signal items as feed events, so the global feed can carry them in its own
 * row format instead of a parallel card system.
 *
 * Interleaved rather than time-sorted: these posts and our registry events do
 * not share a clock (a post can be days old while a publish is minutes old),
 * and sorting by timestamp would either bury every post or flood the top with
 * them. One post every `every` registry events keeps both visible.
 */
export function signalFeedEvents(limit: number): import('./registry-feed-types').FeedSignalEvent[] {
  return getSignalItems(limit).map((item) => ({
    kind: 'signal' as const,
    network: (item.source ?? 'x') as 'x' | 'hn' | 'reddit',
    actor: item.handle,
    actorName: item.name,
    // The avatar the collector captured from the source API. Proxying through
    // unavatar.io rate-limited (429) and rendered broken images for whichever
    // handles lost that lottery; a null here falls back to the monogram.
    actorAvatarUrl: item.avatarUrl ?? null,
    followers: item.followers,
    text: item.text,
    url: item.url,
    score: item.likes,
    views: item.views,
    at: item.createdAt ? Math.floor(new Date(item.createdAt).getTime() / 1000) || 0 : 0,
    context: item.context ?? null,
    skills: item.skills,
    collection: item.collection,
    collections: item.collections ?? [],
    repoCount: item.repos?.length ?? 0,
    unknownSkill: item.unknownSkill,
    // Same prefill the registry makes at import, so a skill we do not carry yet
    // still shows the cover it will get. From the skill's own name and the
    // author's words about it, never our copy.
    unknownCategory: item.unknownSkill
      ? guessCategory({ slug: item.unknownSkill, body: item.text })
      : null,
    repo: item.githubRepo ?? item.collection?.repo ?? null,
  }))
}

/** Slot a post in after every `every` registry events. */
export function interleaveSignal<T extends { kind: string }>(
  events: T[],
  posts: T[],
  every = 3,
): T[] {
  const out: T[] = []
  let p = 0
  events.forEach((event, i) => {
    out.push(event)
    if ((i + 1) % every === 0 && p < posts.length) out.push(posts[p++]!)
  })
  while (p < posts.length) out.push(posts[p++]!)
  return out
}

import { getStories } from './blog'
import type { FeedStoryEvent } from './registry-feed-types'

/**
 * The written stories, as feed events.
 *
 * Authored in the blog admin as posts tagged `story`, so publishing one needs
 * no deploy and every story passes a human before it is public. Clustering raw
 * posts into "here is what the field is arguing about" is editorial work, and
 * an unedited auto-summary of a day's chatter is exactly the slop this feed
 * exists to be better than. The sources list is what makes a story checkable.
 *
 * Degrades to an empty list: the story store is a separate SQLite file from the
 * registry, so it fails independently and must not take the feed with it.
 */
export function storyFeedEvents(limit?: number): FeedStoryEvent[] {
  let stories
  try {
    stories = getStories()
  } catch {
    return []
  }
  const rows = stories
    .filter((post) => (post.sources ?? []).length > 0)
    .map((post) => ({
      kind: 'story' as const,
      id: post.slug,
      storyKind: post.storyKind ?? 'story',
      subject: post.subject,
      headline: post.title,
      summary: post.description,
      at: post.publishedAt ? Math.floor(new Date(post.publishedAt).getTime() / 1000) || 0 : 0,
      sources: (post.sources ?? []).map((src) => ({
        network: src.network,
        handle: src.handle,
        label: src.label,
        detail: src.detail ?? null,
        url: src.url,
        avatarUrl: src.avatarUrl ?? null,
      })),
    }))
  return limit ? rows.slice(0, limit) : rows
}

/** Posts that resolved to something we carry. An unresolved quote is source
 *  material for a story, not a feed item of its own. */
export function resolvedSignalEvents(limit: number) {
  return signalFeedEvents(200)
    .filter((e) => e.skills.length > 0 || e.collection || e.unknownSkill)
    .slice(0, limit)
}
