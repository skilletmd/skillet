import type { SkillSummary } from '@/lib/types'
import { SkillCard } from '@/components/skill-card'

/** Directory card for a catalog skill — the shared {@link SkillCard}. */
export function SkillSummaryCard({ skill }: { skill: SkillSummary }) {
  const description = skill.description?.trim() ? skill.description : null

  return (
    <SkillCard
      author={skill.author}
      slug={skill.slug}
      title={skill.title}
      description={description}
      category={skill.category}
      installCount={skill.install_count}
      visibility={skill.visibility}
    />
  )
}
