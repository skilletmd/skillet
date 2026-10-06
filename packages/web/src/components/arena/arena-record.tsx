import Link from 'next/link'
import { Eyebrow } from '@/components/ui/eyebrow'
import { roundHref, roundsForSkill } from '@/lib/arena/rounds'
import { StatusBadge, VerdictBadge } from '@/components/arena/arena-ui'

/**
 * The skill page's arena record: every round this skill was in, newest first,
 * as one quiet rail row each. Renders nothing for a skill that never competed.
 */
export function ArenaRecord({ author, slug }: { author: string; slug: string }) {
  const rounds = roundsForSkill(author, slug)
  if (rounds.length === 0) return null
  return (
    <section className="arena py-4 first:pt-0">
      <Eyebrow>Arena</Eyebrow>
      <ul className="mt-3 flex flex-col gap-2">
        {rounds.map((round) => {
          const [a, b] = round.versions
          return (
            <li key={round.slug}>
              <Link
                href={roundHref(round.slug)}
                className="block rounded-xl border border-(--line) bg-(--surface) p-3 transition-colors hover:border-[color-mix(in_srgb,var(--line)_50%,var(--ink-2))]"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-(--ink)">
                    {b.version} vs {a.version}
                  </span>
                  {round.result ? (
                    <VerdictBadge result={round.result} />
                  ) : (
                    <StatusBadge round={round} />
                  )}
                </span>
                <span className="mt-1.5 block text-xs leading-relaxed text-(--ink-2)">
                  {round.result ? round.result.summary : round.question}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
