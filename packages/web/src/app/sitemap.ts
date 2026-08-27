import type { MetadataRoute } from 'next'
import {
  getSkillCatalog,
  getKitCatalog,
  getAllAuthorUsernames,
} from '@/lib/registry'
import { getEditorialPosts, getStories } from '@/lib/blog'
import { CATEGORY_BY_KEY } from '@/lib/categories'
import { DOC_NAV } from '@/lib/docs-nav'
import { TOUR_STOPS, tourHref } from '@/lib/tour'
import { skillHref, kitHref, profileHref, browseHref, browseAllHref, blogHref } from '@/lib/urls'

// Public catalog sitemap. Crawlers are always logged-out, so the auth-aware root
// serves them the landing; only public, indexable surfaces belong here. Authed-only
// routes (/feed/*, /settings) and private skills/kits are excluded. Each catalog
// read is guarded so a registry hiccup yields a smaller sitemap, never a build crash.

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://skillet.md'

/**
 * The catalog is PAGED, not fetched in one shot.
 *
 * This used to ask for `limit: 1000` and ship whatever came back. `GET /skills`
 * clamps limit to 100 (`clampInt(req.query.limit, 50, 1, 100)`), so the request
 * succeeded, returned a hundred rows, and the sitemap listed 100 of 1,467 public
 * skills — 7% of the indexable catalog, with nothing anywhere reporting a
 * problem. An over-large limit is not an error on either side; it is silently
 * honoured down to the cap, which is exactly why this went unnoticed.
 *
 * So page to the reported `total` instead of trusting one response. PAGE_SIZE
 * sits at the server cap: asking for more is not refused, just trimmed.
 */
const PAGE_SIZE = 100

/** Stop even if `total` is wrong or the endpoint never drains. 100 pages is
 *  10,000 entries, well past the catalog and well under the 50,000-URL limit a
 *  single sitemap file is allowed. */
const MAX_PAGES = 100

async function pageAll<T>(
  fetchPage: (offset: number) => Promise<{ rows: T[]; total: number }>,
): Promise<T[]> {
  const out: T[] = []
  for (let page = 0; page < MAX_PAGES; page++) {
    const { rows, total } = await safe(fetchPage(page * PAGE_SIZE), { rows: [], total: 0 })
    out.push(...rows)
    // A short page means the end, whatever `total` claims.
    if (rows.length < PAGE_SIZE || out.length >= total) break
  }
  return out
}

const abs = (path: string) => new URL(path, BASE).toString()

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p
  } catch {
    return fallback
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [skills, kits, authors] = await Promise.all([
    pageAll(async (offset) => {
      const c = await getSkillCatalog({ limit: PAGE_SIZE, offset })
      return { rows: c.skills ?? [], total: c.total ?? 0 }
    }),
    pageAll(async (offset) => {
      const c = await getKitCatalog({ limit: PAGE_SIZE, offset })
      return { rows: c.items ?? [], total: c.total ?? 0 }
    }),
    safe(getAllAuthorUsernames(), [] as string[]),
  ])
  const skillCatalog = { skills }
  const kitCatalog = { items: kits }

  // Trust anchors and the docs landing belong here: they are the pages a
  // person (or an AI answer engine) checks to decide whether this project is
  // real, and nothing else in the sitemap links to them.
  //
  // Docs come from DOC_NAV, which is the site's navigation source of truth and
  // already includes the generated API reference pages — so a new operation in
  // the OpenAPI document reaches the sitemap with no edit here. Previously not
  // one docs page was listed, which left the entire reference discoverable only
  // by crawling the sidebar.
  const docRoutes = ['/docs', ...DOC_NAV.flatMap((s) => s.items.map((i) => i.href))]
  const staticRoutes = [
    ...new Set([
      '/',
      browseHref(),
      browseAllHref(),
      blogHref(),
      '/about',
      '/contact',
      '/tour',
      ...TOUR_STOPS.map((stop) => tourHref(stop.slug)),
      ...docRoutes,
    ]),
  ].map((path) => ({
    url: abs(path),
  }))

  const categoryRoutes = Object.keys(CATEGORY_BY_KEY).map((key) => ({
    url: abs(`/browse/${key}`),
  }))

  // Defensive visibility filter — never enumerate private skills even if the
  // catalog endpoint's defaults ever change.
  const skillRoutes = skillCatalog.skills
    .filter((s) => s.visibility !== 'private')
    .map((s) => ({ url: abs(skillHref(s.author, s.slug)) }))

  const kitRoutes = kitCatalog.items
    .filter((k) => k.slug)
    .map((k) => ({ url: abs(kitHref(k.owner, k.slug)) }))

  const authorRoutes = authors.map((handle) => ({ url: abs(profileHref(handle)) }))

  // Blog posts are the only entries with a trustworthy modification date, so
  // they are the only ones carrying lastModified. The registry exposes nothing
  // equivalent for skills, kits, or profiles, and a fabricated date is worse
  // than none. Omit the key rather than emit an invalid date when both are null.
  const blogRoutes = getEditorialPosts().map((post) => {
    const lastModified = post.updatedAt ?? post.publishedAt ?? undefined
    return lastModified
      ? { url: abs(blogHref(post.slug)), lastModified }
      : { url: abs(blogHref(post.slug)) }
  })

  // Stories are posts too, but they live at /news/<slug>, not /blog/<slug>.
  // Listing them under the blog path would offer search engines a second URL
  // for the same content, and the blog path does not even render them.
  const storyRoutes = getStories().map((post) => {
    const lastModified = post.updatedAt ?? post.publishedAt ?? undefined
    const url = abs(`/news/${post.slug}`)
    return lastModified ? { url, lastModified } : { url }
  })

  return [
    ...staticRoutes,
    ...storyRoutes,
    ...categoryRoutes,
    ...skillRoutes,
    ...kitRoutes,
    ...authorRoutes,
    ...blogRoutes,
  ]
}
