import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { markdownAlternates } from '@/lib/markdown-alternate'
import { Suspense } from 'react'
import {
  getSkill,
  getSkillTombstone,
  getKitsForSkill,
  getAuthorProfile,
  getSkillCatalog,
} from '@/lib/registry'
import { humanizeSlug } from '@/lib/humanize-slug'
import { getSkillBundleSummary } from '@/lib/skill-bundle-content'
import { SkillPageView } from '@/components/skills/skill-page-view'
import { SkillAuthenticatedResolve } from '@/components/skills/skill-authenticated-resolve'
import { SkillPageSkeleton } from '@/components/skills/skill-page-skeleton'

// Skill detail lives at /{author}/{skill} — skills are the flat primary object.
// The dynamic [skill] segment is a sibling of the static kit/followers/following
// segments under [author]; Next.js resolves the static ones first, so those
// names always render their real pages (publish-time blocklist keeps a skill
// from ever being slugged with one — see @skillet/protocol reserved-skill-slugs).
interface Params {
  author: string
  skill: string
}

// No generateStaticParams: same build-time registry constraint as /[author] — see
// that route. Skill pages render on-demand (CDN-cached after first hit).

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { author, skill: slug } = await params
  // Metadata is non-critical: a registry outage here must not crash the head —
  // the page body surfaces the unavailable state via its error boundary.
  const skill = await getSkill(author, slug).catch(() => null)
  if (!skill) {
    // A deprecated skill renders a tombstone (200) — de-index it so search
    // engines drop the sunset page. A genuine miss falls through to {}.
    const tombstone = await getSkillTombstone(author, slug).catch(() => null)
    if (tombstone) {
      return {
        title: `${humanizeSlug(slug)} by @${author} (deprecated)`,
        robots: { index: false, follow: false },
      }
    }
    return {}
  }
  // The share image comes from the sibling opengraph-image.tsx (branded renderer
  // with the skill's cover + curator facepile) — kept as the single source so the
  // og:image isn't set twice.
  return {
    title: `${skill.title} by @${author} · Skillet`,
    description: skill.description,
    // The twin here returns the published SKILL.md, so this is the single most
    // useful `rel="alternate"` on the site.
    alternates: markdownAlternates(`/${author}/${slug}`),
    openGraph: {
      title: skill.title,
      description: skill.description,
      type: 'website',
    },
    twitter: { card: 'summary_large_image' },
  }
}

export default async function SkillPage({ params }: { params: Promise<Params> }) {
  const { author, skill: slug } = await params
  const skill = await getSkill(author, slug)

  if (!skill) {
    return (
      <Suspense fallback={<SkillPageSkeleton />}>
        <SkillAuthenticatedResolve author={author} slug={slug} />
      </Suspense>
    )
  }

  const [bundle, publicKits, authorProfile, popular] = await Promise.all([
    // A private skill's manifest/content is ACL'd — without the viewer's session
    // the registry 404s it and the whole file viewer (and rendered SKILL.md body)
    // silently vanishes. Attach the session only for private skills so public
    // pages stay statically CDN-cacheable. Mirrors the evidence-fetch flag in
    // skill-page-view (withSession: visibility === 'private').
    getSkillBundleSummary(author, slug, { withSession: skill.visibility === 'private' }),
    getKitsForSkill(author, slug),
    getAuthorProfile(author).catch(() => null),
    // Discovery fallback for the rail; cheap + cached, ignored unless the rail
    // would otherwise be empty.
    getSkillCatalog({ limit: 8 }).catch(() => null),
  ])

  return await SkillPageView({
    author,
    slug,
    skill,
    bundle,
    publicKits,
    popularSkills: (popular?.skills ?? []).map((s) => ({
      author: s.author,
      slug: s.slug,
      title: s.title,
      category: s.category,
      installCount: s.install_count,
    })),
    authorProfile,
  })
}
