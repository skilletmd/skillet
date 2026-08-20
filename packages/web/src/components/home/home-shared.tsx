import Link from 'next/link'
import type { FeedResult, FeedSkill } from '@/lib/registry'
import type { KitCatalogEntry, PersonCatalogEntry } from '@/lib/registry'
import type { SkillSummary } from '@/lib/types'
import type { Post } from '@/lib/blog'
import { KitCard } from '@/components/kit-card'
import { SkillCard } from '@/components/skill-card'
import { KitCardMenu } from '@/components/kits/kit-card-menu'
import { FollowButton } from '@/components/follow-button'
import { SkillKitControl } from '@/components/kits/skill-kit-control'
import { kitCardMenu } from '@/lib/kit-card-menu'
import { humanizeSlug } from '@/components/skill-card'
import { SkillIcon, KitStackIcon, kitCoverCategories } from '@/components/directory-card'
import { Avatar } from '@/components/ui/avatar'
import { Panel } from '@/components/ui/panel'
import { ArrowRight } from '@/components/ui/icons'
import { kitHref, skillHref } from '@/lib/urls'
import { SHELF_TITLE_CLASS } from '@/lib/page-layout'
import { softRegistry } from '@/lib/registry-soft'

export const CHART_SIZE = 10
// Fixed responsive columns: a tidy row of 3 from sm up, 2-up on the narrowest
// screens. The handful of featured kits fits one row; more wrap to a second.
export const KITS_GRID_CLASS = 'grid grid-cols-2 gap-4 sm:grid-cols-3'

const SKILLS_GRID = 'grid grid-cols-1 gap-4 md:grid-cols-2'
const numberFormat = new Intl.NumberFormat('en-US')

/** Rank-row metric with the registry-wide zero rule: a real count reads as
 *  "1,240 installs"; zero never prints "0 installs" (it reads as no traction) —
 *  it shows the "New" status instead, matching the card/rail treatment. */
function metricCount(value: number, label: string): { metric: string; metricLabel: string } {
  return value > 0
    ? { metric: numberFormat.format(value), metricLabel: label }
    : { metric: 'New', metricLabel: '' }
}

/** A registry call that must not blank the homepage: a hiccup degrades to an
 *  empty shelf rather than throwing the whole page into the error boundary. */
export async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  return softRegistry('home shelf soft-fail', p, fallback)
}

export function recentSkills(feed: FeedResult | null, max: number): FeedSkill[] {
  if (!feed) return []
  const seen = new Set<string>()
  const out: FeedSkill[] = []
  for (const e of feed.events) {
    if (e.kind !== 'skill') continue
    const key = `${e.skill.author}/${e.skill.slug}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e.skill)
    if (out.length >= max) break
  }
  return out
}

/** Maker handle → avatar, resolved from the people catalog (the skill/kit feed
 *  rows don't carry the author's avatar). Used for the small maker chip on each
 *  card; the "used by" faces are real and come from each card's own data. */
export function avatarMapFromPeople(people: PersonCatalogEntry[]): Map<string, string | null> {
  return new Map(people.map((p) => [p.handle, p.avatarUrl]))
}

/**
 * The one "see all" affordance for every shelf/chart header. Quiet by default —
 * muted text, no arrow — so the content stays the hero; on hover (of the whole
 * header, via `group/shelf`) it warms to the accent and slides its arrow in. One
 * wording, one treatment, one position everywhere.
 */
export function SeeAllLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-(--ink-2) transition-colors hover:text-(--accent) group-hover/shelf:text-(--accent)"
    >
      See all
      {/* Opacity stays ungated (it is the arrow's visibility affordance); only
          the nudge is pointer-gated, so a tap can't leave it stuck mid-slide. */}
      <ArrowRight className="opacity-0 transition-[opacity,transform] duration-200 group-hover/shelf:opacity-100 [@media(hover:hover)]:group-hover/shelf:translate-x-0.5" />
    </Link>
  )
}

export function Shelf({
  title,
  blurb,
  seeAllHref,
  children,
}: {
  title?: string
  blurb?: string
  seeAllHref?: string
  children: React.ReactNode
}) {
  // With no title/blurb/link the header row is empty — drop it so the content
  // sits directly under whatever heading already precedes it (e.g. the /browse
  // page's own "Featured" h1).
  const hasHeader = title || blurb || seeAllHref
  return (
    <section className="mt-12 first:mt-0">
      {hasHeader && (
        <div className="group/shelf mb-4 flex items-baseline justify-between gap-4">
          <div>
            {title && <h2 className={SHELF_TITLE_CLASS}>{title}</h2>}
            {blurb && <p className="mt-1 text-sm text-(--ink-2)">{blurb}</p>}
          </div>
          {seeAllHref && <SeeAllLink href={seeAllHref} />}
        </div>
      )}
      {children}
    </section>
  )
}

export function SkillEventGrid({
  skills,
  avatarByHandle,
}: {
  skills: FeedSkill[]
  avatarByHandle: Map<string, string | null>
}) {
  return (
    <div className={SKILLS_GRID}>
      {skills.map((s) => (
        <SkillCard
          key={`${s.author}/${s.slug}`}
          size="md"
          author={s.author}
          slug={s.slug}
          description={s.description}
          category={s.category}
          installCount={s.installs}
          makerAvatarUrl={avatarByHandle.get(s.author) ?? null}
          // Real social proof: people you follow who use this skill. Empty for
          // logged-out viewers → the card shows a count only, never fake faces.
          usedByFaces={(s.followedByYou ?? []).map((handle) => ({
            handle,
            name: handle,
            avatarUrl: null,
          }))}
        />
      ))}
    </div>
  )
}

function RankRow({
  rank,
  href,
  visual,
  title,
  subtitle,
  metric,
  metricLabel,
  action,
}: {
  rank: number
  href: string
  visual: React.ReactNode
  title: string
  subtitle: React.ReactNode
  metric: string
  metricLabel: string
  action?: React.ReactNode
}) {
  return (
    // Stretched-link row: the primary link (the title) covers the whole row via
    // an after:inset-0 pseudo, so the subtitle can carry its own anchors (the
    // @handle → author profile) that sit above it with relative z-[1].
    <li className="group/row group relative border-t border-(--line) first:border-t-0 transition-colors hover:bg-(--accent-bg)">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <span className="w-4 shrink-0 text-right text-sm font-medium tabular-nums text-(--ink-2)/55">
          {rank}
        </span>
        {visual}
        <span className="min-w-0 flex-1">
          {/* after:inset-0 stretches over the li; truncate lives on the inner
              span so its overflow:hidden doesn't clip the stretched pseudo. */}
          <Link href={href} className="block after:absolute after:inset-0 after:content-['']">
            <span className="block truncate font-semibold leading-tight tracking-[-0.01em] text-(--ink) group-hover:text-(--accent)">
              {title}
            </span>
          </Link>
          {/* Fixed-height subtitle line (fits the xxs maker avatar) so rows with
              an avatar chip and text-only rows are the same height naturally. */}
          <span className="mt-0.5 flex h-5 min-w-0 items-center gap-1.5 text-xs text-(--ink-2)">
            {subtitle}
          </span>
        </span>
        <span
          className={`shrink-0 text-right${
            action
              ? ' transition-opacity duration-150 group-hover/row:opacity-0 group-focus-within/row:opacity-0 [@media(hover:none)]:opacity-0'
              : ''
          }`}
        >
          <span
            className={`block text-sm font-semibold leading-tight tabular-nums ${metricLabel ? 'text-(--ink)' : 'text-(--ink-2)'}`}
          >
            {metric}
          </span>
          {metricLabel && (
            <span className="mt-0.5 block text-xs leading-none text-(--ink-2)/80">
              {metricLabel}
            </span>
          )}
        </span>
      </div>
      {action ? (
        <div className="pointer-events-none absolute inset-y-0 right-4 z-10 flex items-center opacity-0 transition-opacity duration-150 group-hover/row:pointer-events-auto group-hover/row:opacity-100 group-focus-within/row:pointer-events-auto group-focus-within/row:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
          {action}
        </div>
      ) : null}
    </li>
  )
}

function ChartIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative h-11 w-11 shrink-0" aria-hidden="true">
      {children}
    </span>
  )
}

function MiniChart({
  title,
  blurb,
  seeAllHref,
  children,
}: {
  title: string
  blurb: string
  seeAllHref?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="group/shelf mb-4 flex items-baseline justify-between gap-4">
        <div>
          <h2 className={SHELF_TITLE_CLASS}>{title}</h2>
          <p className="mt-1 text-sm text-(--ink-2)">{blurb}</p>
        </div>
        {seeAllHref && <SeeAllLink href={seeAllHref} />}
      </div>
      <Panel as="ol" padding="none" className="overflow-hidden">
        {children}
      </Panel>
    </section>
  )
}

type ContentRank = {
  key: string
  href: string
  owner: string
  ownerAvatarUrl: string | null
  title: string
  value: number
  metricLabel: string
  visual: React.ReactNode
  action: React.ReactNode
}

function mergeContent(
  skills: SkillSummary[],
  kits: KitCatalogEntry[],
  avatarByHandle: Map<string, string | null>,
  viewerHandle: string | null,
  max: number = CHART_SIZE,
): ContentRank[] {
  const skillItems: ContentRank[] = skills.map((s) => ({
    key: `skill:${s.skill_id}`,
    href: skillHref(s.author, s.slug),
    owner: s.author,
    ownerAvatarUrl: avatarByHandle.get(s.author) ?? null,
    title: s.title?.trim() ? s.title : humanizeSlug(s.slug),
    value: s.install_count ?? 0,
    metricLabel: 'installs',
    // Logged out there's no add action, so omit it — otherwise the row hides the
    // install count on hover and replaces it with nothing (a blank row).
    action: viewerHandle ? (
      <SkillKitControl author={s.author} slug={s.slug} variant="compact" />
    ) : undefined,
    visual: (
      <ChartIcon>
        <SkillIcon seed={`${s.author}/${s.slug}`} category={s.category} />
      </ChartIcon>
    ),
  }))
  const kitItems: ContentRank[] = kits.map((k) => ({
    key: `kit:${k.id}`,
    href: kitHref(k.owner, k.slug),
    owner: k.owner,
    ownerAvatarUrl: avatarByHandle.get(k.owner) ?? null,
    title: k.name,
    value: k.subscriberCount,
    metricLabel: k.subscriberCount === 1 ? 'sub' : 'subs',
    action: viewerHandle ? (
      <KitCardMenu {...kitCardMenu({ kitId: k.id, owner: k.owner, viewerHandle })} />
    ) : undefined,
    visual: (
      <ChartIcon>
        <KitStackIcon
          seed={k.id}
          categories={kitCoverCategories(k.skillCategories ?? [], k.category, k.skillCount, k.id)}
        />
      </ChartIcon>
    ),
  }))
  return [...skillItems, ...kitItems].sort((a, b) => b.value - a.value).slice(0, max)
}

export function ChartsRow({
  skills,
  kits,
  creators,
  viewerHandle,
  chartSize = CHART_SIZE,
  seeAll = true,
}: {
  skills: SkillSummary[]
  kits: KitCatalogEntry[]
  creators: PersonCatalogEntry[]
  viewerHandle: string | null
  chartSize?: number
  seeAll?: boolean
}) {
  const avatarByHandle = new Map(creators.map((c) => [c.handle, c.avatarUrl]))
  const content = mergeContent(skills, kits, avatarByHandle, viewerHandle, chartSize)
  const topCreators = creators.slice(0, chartSize)
  if (content.length === 0 && topCreators.length === 0) return null

  return (
    <section className="mt-12 first:mt-0">
      <div className="grid grid-cols-1 gap-x-8 gap-y-10 sm:grid-cols-2">
        {content.length > 0 && (
          <MiniChart
            title="Top skills & kits"
            blurb="Most popular across Skillet."
            seeAllHref={seeAll ? '/browse' : undefined}
          >
            {content.map((c, i) => (
              <RankRow
                key={c.key}
                rank={i + 1}
                href={c.href}
                visual={c.visual}
                title={c.title}
                subtitle={
                  // Above the row's stretched title link (relative z-[1]) so the
                  // byline routes to the author, not the skill/kit.
                  <Link
                    href={`/${c.owner}`}
                    className="relative z-[1] flex min-w-0 items-center gap-1.5 hover:text-(--ink) hover:underline underline-offset-2"
                  >
                    <Avatar
                      src={c.ownerAvatarUrl}
                      name={c.owner}
                      colorKey={c.owner}
                      size="xxs"
                      aria-hidden="true"
                    />
                    <span className="truncate font-medium">@{c.owner}</span>
                  </Link>
                }
                {...metricCount(c.value, c.metricLabel)}
                action={c.action}
              />
            ))}
          </MiniChart>
        )}

        {topCreators.length > 0 && (
          <MiniChart
            title="Top creators"
            blurb="By total installs across their skills."
            seeAllHref={seeAll ? '/browse/people' : undefined}
          >
            {topCreators.map((p, i) => (
              <RankRow
                key={p.handle}
                rank={i + 1}
                href={`/${p.handle}`}
                visual={
                  <Avatar
                    src={p.avatarUrl}
                    name={p.name}
                    colorKey={p.handle}
                    size="md"
                    className="h-11 w-11"
                    aria-hidden="true"
                  />
                }
                title={p.name}
                subtitle={<span className="truncate font-medium">@{p.handle}</span>}
                {...metricCount(p.totalInstalls, 'installs')}
                action={
                  viewerHandle == null || viewerHandle === p.handle ? undefined : (
                    <FollowButton
                      author={p.handle}
                      initialFollowing={p.viewerFollows}
                      isAuthed
                      appearance="card"
                    />
                  )
                }
              />
            ))}
          </MiniChart>
        )}
      </div>
    </section>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function postCategory(tags: string[]): string {
  return tags.find((t) => t !== 'skills') ?? tags[0] ?? 'blog'
}

function postDate(iso: string | null): string {
  if (!iso) return ''
  // Accept a bare date (YYYY-MM-DD) or a full ISO datetime; take the date part.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

export function FromTheBlog({ posts }: { posts: Post[] }) {
  if (posts.length === 0) return null
  return (
    <Shelf
      title="From the blog"
      blurb="Field notes and guides on building with skills."
      seeAllHref="/blog"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post) => (
          <Link
            key={post.slug}
            href={`/blog/${post.slug}`}
            className="group flex flex-col surface-card p-5 transition-shadow duration-[180ms] ease-[var(--ease)] hover:shadow-[0_4px_24px_rgba(0,0,0,0.07)]"
          >
            <span className="font-mono text-xs uppercase tracking-[0.08em] text-(--accent)">
              {postCategory(post.tags)}
            </span>
            <h3 className="mt-2 text-lg font-semibold leading-[1.2] tracking-[-0.02em] group-hover:underline">
              {post.title}
            </h3>
            <p className="mt-2 text-sm leading-[1.55] text-(--ink-2)">{post.description}</p>
            <div className="mt-auto flex flex-wrap items-center gap-x-1.5 pt-4 text-xs text-(--ink-2)/65">
              {post.publishedAt && <span>{postDate(post.publishedAt)}</span>}
              {post.readTime && (
                <>
                  <span aria-hidden>·</span>
                  <span>{post.readTime} min read</span>
                </>
              )}
            </div>
          </Link>
        ))}
      </div>
    </Shelf>
  )
}
