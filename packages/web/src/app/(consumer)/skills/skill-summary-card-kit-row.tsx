'use client'

import { SkillKitControl } from '@/components/kits/skill-kit-control'

export function SkillSummaryCardKitRow({ author, slug }: { author: string; slug: string }) {
  return (
    <div className="relative z-10 mt-3">
      <SkillKitControl author={author} slug={slug} variant="compact" />
    </div>
  )
}
