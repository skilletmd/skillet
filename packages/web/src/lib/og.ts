import type { Metadata } from 'next'
import { compactCount } from '@/lib/format-count'

// Single source of truth for OG share cards. Pages call `ogMeta(...)` in their
// metadata; the /lab/og gallery calls the same builders so the previews are
// exactly what ships. The image itself renders at /api/og.

export interface OgArgs {
  type: string
  eyebrow?: string
  title: string
  subtitle?: string
  handle?: string
  stat?: string
  chip?: string
  /** Team/org identity — the avatar renders as a monogram square, not a face. */
  team?: boolean
  /** Ref (`author/slug` for a skill, kit id/name for a kit) that seeds the
   *  deterministic generated cover — the same art the card shows in-app. */
  mark?: string
  /** A kit's member-skill categories (parallel, nulls allowed) — colors the
   *  blended kit cover by what's inside it. */
  cats?: (string | null)[]
  /** Handles of real users for the facepile (skill curators / kit subscribers). */
  faces?: string[]
}

export function ogImagePath(a: OgArgs): string {
  const q = new URLSearchParams()
  q.set('type', a.type)
  q.set('title', a.title)
  if (a.eyebrow) q.set('eyebrow', a.eyebrow)
  if (a.subtitle) q.set('subtitle', a.subtitle)
  if (a.handle) q.set('handle', a.handle)
  if (a.stat) q.set('stat', a.stat)
  if (a.chip) q.set('chip', a.chip)
  if (a.team) q.set('team', '1')
  if (a.mark) q.set('mark', a.mark)
  if (a.cats?.length) q.set('cats', a.cats.map((c) => c ?? '').join(','))
  if (a.faces?.length) q.set('faces', a.faces.join(','))
  return `/api/og?${q.toString()}`
}

/** Spread into a page's `metadata` to set the OG + Twitter share card.
 *  Next replaces (never merges) a parent segment's `openGraph` object, so the
 *  layout's `siteName`/`type` vanish from any page that spreads this. Re-stating
 *  them here is what keeps og:site_name and og:type on every share card. */
export function ogMeta(a: OgArgs): Pick<Metadata, 'openGraph' | 'twitter'> {
  const url = ogImagePath(a)
  return {
    openGraph: {
      type: a.type === 'blog' ? 'article' : 'website',
      siteName: 'Skillet',
      images: [{ url, width: 1200, height: 630 }],
    },
    twitter: { card: 'summary_large_image', images: [url] },
  }
}

const truncate = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const compact = (n: number) => compactCount(n)

// ── per page-type builders (used by pages AND the gallery) ──────────────────
export const OG = {
  // Headline-only — the homepage is the handshake; let the pitch land alone, big.
  // (Brand line in the header + the headline already say it; a subtitle is a
  // fourth way of saying the same thing.)
  home: (): OgArgs => ({
    type: 'home',
    chip: 'skillet',
    title: 'Genius on tap',
  }),
  skills: (): OgArgs => ({
    type: 'skills',
    chip: 'skills',
    title: 'Skills',
  }),
  skill: (s: {
    author: string
    slug: string
    description?: string | null
    installs?: number
    /** Drives the cover's color + section shape (matches the in-app cover). */
    category?: string | null
    /** People who use this skill — drives the facepile. */
    faces?: string[]
  }): OgArgs => ({
    type: 'skill',
    chip: 'skill',
    eyebrow: 'skill',
    title: s.slug,
    // No description — the slug, author, and facepile carry it; cleaner without.
    handle: s.author,
    // Adoption only when it BRAGS — a low count reads as a negative on a
    // share card (same reasoning as omitting followers on profiles).
    stat: s.installs && s.installs >= 100 ? `added by ${compact(s.installs)}` : undefined,
    // Cover seed = the skill ref, exactly like <Cover seed={author/slug}>.
    mark: `${s.author}/${s.slug}`,
    cats: s.category ? [s.category] : undefined,
    faces: s.faces?.length ? s.faces : undefined,
  }),
  profile: (p: {
    handle: string
    name: string
    bio?: string | null
    followers?: number
    /** Total installs across their skills — the headline credibility stat. */
    installs?: number
    /** Count of public skills they've published. */
    skills?: number
    /** Top categories (keys) — rendered as colored chips, like /browse. */
    cats?: (string | null)[]
    isTeam?: boolean
  }): OgArgs => {
    // installs · skills — the credibility signals. Followers is deliberately
    // omitted: a low count ("4 followers") reads as a negative on a share card.
    const parts: string[] = []
    if (p.installs && p.installs > 0) parts.push(`${compact(p.installs)} installs`)
    if (p.skills && p.skills > 0) parts.push(`${p.skills} ${p.skills === 1 ? 'skill' : 'skills'}`)
    return {
      type: 'profile',
      chip: p.isTeam ? 'team' : 'profile',
      // No eyebrow — the type chip (PROFILE/TEAM) top-right already labels it.
      title: p.name,
      subtitle: p.bio ? truncate(p.bio, 90) : undefined,
      handle: p.handle,
      stat: parts.length ? parts.join('  ·  ') : undefined,
      cats: p.cats?.length ? p.cats : undefined,
      team: p.isTeam,
    }
  },
  feed: (): OgArgs => ({
    type: 'feed',
    chip: 'feed',
    eyebrow: 'your feed',
    title: 'From people you follow',
  }),
  team: (name: string): OgArgs => ({
    type: 'team',
    chip: 'team',
    eyebrow: 'team',
    title: name,
  }),
  kit: (k: {
    name: string
    /** Kit id — the exact cover seed (<KitCoverStack seed={kit.id}>). */
    seed?: string
    handle?: string
    count?: number
    subscribers?: number
    /** Member-skill categories — colors the cover by what's inside. */
    cats?: (string | null)[]
    /** Subscribers — drives the facepile. */
    faces?: string[]
  }): OgArgs => ({
    type: 'kit',
    chip: 'kit',
    eyebrow: 'kit',
    title: k.name,
    // No subtitle: the eyebrow names the kind, the cover's edition stamp
    // carries the count, the author row carries the who.
    handle: k.handle,
    // Same brag-threshold as skills: silence beats "added by 2".
    stat: k.subscribers != null && k.subscribers >= 100 ? `added by ${compact(k.subscribers)}` : undefined,
    mark: k.seed ?? k.name,
    cats: k.cats?.length ? k.cats : undefined,
    faces: k.faces?.length ? k.faces : undefined,
  }),
  docs: (p?: { title?: string }): OgArgs => ({
    type: 'docs',
    chip: 'docs',
    // Article pages: DOCS eyebrow + the article title, nothing else — the
    // headline does the work (same rule as blog). The index keeps its blurb.
    eyebrow: p?.title ? 'docs' : undefined,
    title: p?.title ?? 'Docs',
  }),
  stats: (): OgArgs => ({
    type: 'stats',
    chip: 'stats',
    eyebrow: 'open data',
    title: 'Skillet by the numbers',
  }),
  // Title-only — the headline does the work; eyebrow + description is clutter.
  blog: (p: { title: string; subtitle?: string }): OgArgs => ({
    type: 'blog',
    chip: 'blog',
    eyebrow: 'blog',
    title: p.title,
  }),
  install: (): OgArgs => ({
    type: 'install',
    chip: 'install',
    title: 'Install Skillet',
  }),
}
