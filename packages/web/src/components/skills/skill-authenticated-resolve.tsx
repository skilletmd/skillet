import { notFound } from 'next/navigation'
import {
  getSkill,
  getSkillTombstone,
  getKitsForSkill,
  getAuthorProfile,
  getSkillCatalog,
} from '@/lib/registry'
import { getSkillBundleSummary } from '@/lib/skill-bundle-content'
import { SkillPageView } from '@/components/skills/skill-page-view'
import { SkillTombstone } from '@/components/skills/skill-tombstone'

/** Loads a private or session-gated skill after the public fetch returned null. */
export async function SkillAuthenticatedResolve({
  author,
  slug,
}: {
  author: string
  slug: string
}) {
  const [skill, bundle, publicKits, authorProfile, popular] = await Promise.all([
    getSkill(author, slug, { withSession: true }),
    getSkillBundleSummary(author, slug, { withSession: true }),
    getKitsForSkill(author, slug),
    getAuthorProfile(author).catch(() => null),
    getSkillCatalog({ limit: 8 }).catch(() => null),
  ])
  if (!skill) {
    // Still null after the session retry: either the skill genuinely doesn't
    // exist (→ 404) or the author deprecated it (→ tombstone). The registry
    // answers 410 for the latter; getSkillTombstone reads that body.
    const tombstone = await getSkillTombstone(author, slug)
    if (tombstone) {
      return <SkillTombstone author={author} slug={slug} {...tombstone} />
    }
    notFound()
  }

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
