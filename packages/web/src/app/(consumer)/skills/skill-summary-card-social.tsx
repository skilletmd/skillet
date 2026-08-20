'use client'

import { useFollowedCurationsOptional } from '@/components/kits/followed-curations-context'

/**
 * "Used by people you follow" line on a catalog card. Reads the shared
 * followed-curations map (one request for the whole grid), so it's free per
 * card. Renders nothing when the viewer follows no one who curates this skill.
 */
export function SkillSummaryCardSocial({ author, slug }: { author: string; slug: string }) {
  const ctx = useFollowedCurationsOptional()
  const handles = ctx?.usedByYou(author, slug) ?? []
  if (handles.length === 0) return null

  const [first, second] = handles
  const extra = handles.length - (second ? 2 : 1)
  const names =
    handles.length === 1
      ? `@${first}`
      : extra > 0
        ? `@${first}, @${second} +${extra}`
        : `@${first} and @${second}`

  return (
    <p className="relative z-10 mt-2 font-mono text-xs text-(--accent)">Used by {names} you follow</p>
  )
}
