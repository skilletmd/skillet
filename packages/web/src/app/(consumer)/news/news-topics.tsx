/**
 * The topic rail — the front door Trevin asked for: "I wonder what's happening in
 * code review skill land." A topic is a category, and its count is how many skills
 * carry it today. Ordered by size so the busy rooms lead.
 *
 * Categories with no skills are dropped rather than shown at zero: an empty room
 * is a worse first impression than a shorter rail.
 */
import Link from 'next/link'
import { CATEGORIES } from '@/lib/categories'
import type { CategoryStat } from '@/lib/registry-stats'

export function NewsTopics({ stats }: { stats: CategoryStat[] }) {
  const rows = stats
    .map((s) => ({ stat: s, meta: CATEGORIES.find((c) => c.key === s.key) }))
    .filter((r) => r.meta && r.stat.skills > 0)
    .sort((a, b) => b.stat.skills - a.stat.skills)

  if (rows.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {rows.map(({ stat, meta }) => (
        <Link
          key={stat.key}
          href={`/browse/${stat.key}`}
          className="flex items-baseline gap-2 rounded-lg border border-(--line) bg-(--surface) px-3 py-2 transition-colors hover:border-(--ink-2) hover:bg-(--card-pop)"
        >
          <span className="text-sm font-semibold">{meta!.label}</span>
          <span className="font-mono text-xs text-(--ink-2) tabular-nums">{stat.skills}</span>
        </Link>
      ))}
    </div>
  )
}
