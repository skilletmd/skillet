import Link from 'next/link'
import { Eyebrow } from '@/components/ui/eyebrow'
import type { SkillMergedFrom } from '@/lib/types'

/**
 * The skills a merged skill was made from (kit map plan U15, R23): each public
 * source by name, linked to its page, with its maker; the private ones only as
 * a count, never named.
 */
export function MergedFrom({ from }: { from: SkillMergedFrom }) {
  const { sources, privateCount } = from
  if (sources.length === 0 && privateCount === 0) return null
  return (
    <div className="mt-8 max-w-[68ch]">
      <Eyebrow>Merged from</Eyebrow>
      <ul className="mt-2 space-y-1.5 text-base leading-[1.5] text-(--ink-2)">
        {sources.map((source) => {
          const [owner] = source.ref.slice(1).split('/')
          return (
            <li key={source.ref} className="flex flex-wrap gap-x-2">
              <Link
                href={`/${source.ref.slice(1)}`}
                className="font-medium text-(--ink) underline decoration-(--line) underline-offset-4 hover:decoration-(--ink-2)"
              >
                {source.name}
              </Link>
              <span>@{owner}</span>
            </li>
          )
        })}
        {privateCount > 0 && <li>{`${privateCount} private skill${privateCount === 1 ? '' : 's'}`}</li>}
      </ul>
    </div>
  )
}
