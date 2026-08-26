/**
 * The feed — one ranked stream, two kinds of item.
 *
 * A **post** is something a person said about skills, with a link into the
 * registry when it resolves to one. A **drop** is a skill that just landed. They
 * interleave on purpose: a page of only posts is a Twitter clone, a page of only
 * drops is the grid we already know does not bring anyone back. Alternating is
 * what makes scrolling feel like something is happening.
 */
import Link from 'next/link'
import { Avatar } from '@/components/ui/avatar'
import { CATEGORIES } from '@/lib/categories'
import type { SignalItem } from '@/lib/news-signal'
import type { FeedEvent } from '@/lib/registry-feed-types'

type SkillEvent = Extract<FeedEvent, { kind: 'skill' }>
type Row = { kind: 'post'; post: SignalItem } | { kind: 'drop'; drop: SkillEvent }

function compact(n: number | null | undefined): string | null {
  if (!n) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return String(n)
}

function categoryLabel(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key
}

/** Trim to a pull-quote without cutting mid-word or trailing a bare link. */
function quote(text: string, max = 300): string {
  const clean = text
    .replace(/https?:\/\/t\.co\/\S+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, clean.lastIndexOf(' ', max))}…`
}

const CHIP =
  'rounded-pill border border-(--line) bg-(--card-soft) px-2 py-0.5 font-mono text-xs whitespace-nowrap'

function Enrichment({ post }: { post: SignalItem }) {
  if (post.match === 'named' && post.skills.length > 0) {
    return (
      <>
        <span className="font-mono text-2xs tracking-[0.08em] uppercase text-(--ink-2)">
          points at
        </span>
        {post.skills.map((s) => (
          <Link
            key={`${s.author}/${s.slug}`}
            href={`/${s.author}/${s.slug}`}
            className={`${CHIP} hover:border-(--ink-2)`}
          >
            @{s.author}/{s.slug}
          </Link>
        ))}
      </>
    )
  }
  if (post.match === 'collection' && post.collection) {
    return (
      <>
        <span className="font-mono text-2xs tracking-[0.08em] uppercase text-(--ink-2)">
          about
        </span>
        <Link href={`/${post.collection.author}`} className={`${CHIP} hover:border-(--ink-2)`}>
          @{post.collection.author}
          <span className="text-(--ink-2)"> · {post.collection.count} skills</span>
        </Link>
      </>
    )
  }
  if (post.unknownSkill) {
    return (
      <>
        <span className="font-mono text-2xs tracking-[0.08em] uppercase text-(--ink-2)">
          names
        </span>
        <span className={`${CHIP} text-(--ink-2)`}>
          {post.unknownSkill} · not in the registry
        </span>
      </>
    )
  }
  // Topic keys come from keyword matching and are wrong often enough that a
  // visible chip misinforms ("database" on a post about company skill libraries).
  // They still drive /news/<topic> filtering; they just do not get rendered here.
  return null
}

/** Does this post have anything to show under the rule? */
function hasEnrichment(post: SignalItem): boolean {
  if (post.match === 'named' && post.skills.length > 0) return true
  if (post.match === 'collection' && post.collection) return true
  return Boolean(post.unknownSkill)
}

/** Engagement reads differently per network, so label it in that network's own
 *  words rather than flattening everything to "likes". */
function engagement(post: SignalItem): string | null {
  const n = compact(post.likes)
  if (!n) return null
  if (post.source === 'hn') return `${n} points`
  if (post.source === 'reddit') return `${n} upvotes`
  const views = compact(post.views)
  return views ? `${n} likes · ${views} views` : `${n} likes`
}

const SOURCE_LABEL: Record<string, string> = { x: 'X', hn: 'Hacker News', reddit: 'Reddit' }

function PostRow({ post }: { post: SignalItem }) {
  const src = post.source ?? 'x'
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-(--line) bg-(--surface) p-4">
      <div className="flex items-center gap-2.5">
        <Avatar
          src={src === 'x' ? `https://unavatar.io/x/${post.handle}` : null}
          name={post.name ?? post.handle ?? '?'}
          colorKey={post.handle ?? 'anon'}
          size="xs"
        />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-bold">{post.name ?? post.handle}</div>
          <div className="truncate font-mono text-2xs text-(--ink-2)">
            {src === 'x' ? `@${post.handle}` : SOURCE_LABEL[src]}
            {post.followers ? ` · ${compact(post.followers)}` : ''}
            {post.context ? ` · ${post.context}` : ''}
          </div>
        </div>
        <span className="ml-auto shrink-0 font-mono text-2xs text-(--ink-2) tabular-nums">
          {engagement(post)}
        </span>
      </div>
      <a href={post.url} className="text-base leading-normal hover:underline">
        “{quote(post.text)}”
      </a>
      {hasEnrichment(post) ? (
        <div className="mt-auto flex flex-wrap items-center gap-1.5 border-t border-(--line) pt-3">
          <Enrichment post={post} />
        </div>
      ) : null}
    </article>
  )
}

function DropRow({ drop }: { drop: SkillEvent }) {
  const { skill } = drop
  return (
    <Link
      href={`/${skill.author}/${skill.slug}`}
      className="flex flex-col gap-2 rounded-xl border border-dashed border-(--line) bg-(--card-soft) p-4 transition-colors hover:border-(--ink-2)"
    >
      <div className="flex items-center gap-2.5">
        <Avatar
          src={drop.actorAvatarUrl}
          name={skill.author}
          colorKey={skill.author}
          size="xs"
        />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-bold">
            <span className="font-medium text-(--ink-2)">@{skill.author}/</span>
            {skill.slug}
          </div>
          <div className="font-mono text-2xs tracking-[0.05em] uppercase text-(--ink-2)">
            {drop.type === 'published' ? 'just landed' : 'updated'}
            {skill.version ? ` · v${skill.version}` : ''}
          </div>
        </div>
      </div>
      {skill.description ? (
        <p className="line-clamp-3 text-sm leading-normal text-(--ink-2)">
          {skill.description}
        </p>
      ) : null}
      {skill.category ? (
        <span className={`${CHIP} mt-auto w-fit tracking-[0.05em] uppercase text-(--ink-2)`}>
          {categoryLabel(skill.category)}
        </span>
      ) : null}
    </Link>
  )
}

/** Slot a drop in after every `every` posts, so the stream keeps changing shape. */
function interleave(posts: SignalItem[], drops: SkillEvent[], every = 3): Row[] {
  const rows: Row[] = []
  let d = 0
  posts.forEach((post, i) => {
    rows.push({ kind: 'post', post })
    if ((i + 1) % every === 0 && d < drops.length) {
      rows.push({ kind: 'drop', drop: drops[d++]! })
    }
  })
  while (d < drops.length) rows.push({ kind: 'drop', drop: drops[d++]! })
  return rows
}

export function NewsFeed({
  posts,
  drops,
  dropLimit,
}: {
  posts: SignalItem[]
  drops: FeedEvent[]
  /** Cap on interleaved drops — the feed is led by what people said, not by
   *  everything the registry ingested overnight. */
  dropLimit?: number
}) {
  const skillDrops = drops
    .filter((e): e is SkillEvent => e.kind === 'skill')
    .slice(0, dropLimit ?? drops.length)
  const rows = interleave(posts, skillDrops)

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-(--line) p-6 text-center text-sm text-(--ink-2)">
        Nothing on the wire yet today.
      </p>
    )
  }

  return (
    <div className="columns-1 gap-3 sm:columns-2 lg:columns-3 [&>*]:mb-3 [&>*]:break-inside-avoid">
      {rows.map((row) =>
        row.kind === 'post' ? (
          <PostRow key={row.post.url} post={row.post} />
        ) : (
          <DropRow key={`${row.drop.skill.author}/${row.drop.skill.slug}`} drop={row.drop} />
        ),
      )}
    </div>
  )
}
