import type { MetadataRoute } from 'next'
import {
  getSkillCatalog,
  getKitCatalog,
  getAllAuthorUsernames,
} from '@/lib/registry'
import { getAllPosts } from '@/lib/blog'
import { CATEGORY_BY_KEY } from '@/lib/categories'
import { DOC_NAV } from '@/lib/docs-nav'
import { TOUR_STOPS, tourHref } from '@/lib/tour'
import { skillHref, kitHref, profileHref, browseHref, browseAllHref, blogHref } from '@/lib/urls'

// Public catalog sitemap. Crawlers are always logged-out, so the auth-aware root
// serves them the landing; only public, indexable surfaces belong here. Authed-only
// routes (/feed/*, /settings) and private skills/kits are excluded. Each catalog
// read is guarded so a registry hiccup yields a smaller sitemap, never a build crash.

const BASE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://skillet.md'
const CATALOG_LIMIT = 1000

const abs = (path: string) => new URL(path, BASE).toString()

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p
  } catch {
    return fallback
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [skillCatalog, kitCatalog, authors] = await Promise.all([
    safe(getSkillCatalog({ limit: CATALOG_LIMIT }), { skills: [], total: 0, limit: 0, offset: 0 }),
    safe(getKitCatalog({ limit: CATALOG_LIMIT }), { items: [], total: 0, limit: 0, offset: 0 }),
    safe(getAllAuthorUsernames(), [] as string[]),
  ])

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
  const blogRoutes = getAllPosts().map((post) => {
    const lastModified = post.updatedAt ?? post.publishedAt ?? undefined
    return lastModified
      ? { url: abs(blogHref(post.slug)), lastModified }
      : { url: abs(blogHref(post.slug)) }
  })

  return [
    ...staticRoutes,
    ...categoryRoutes,
    ...skillRoutes,
    ...kitRoutes,
    ...authorRoutes,
    ...blogRoutes,
  ]
}
