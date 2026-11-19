import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import {
  JuryList,
  PairsTable,
  PreviewNote,
  RoundResult,
  StatusBadge,
  VersionCards,
} from '@/components/arena/arena-ui'
import {
  ARENA_BAR,
  ARENA_ROUNDS,
  findRound,
  neededFor,
  roundHref,
  voteHref,
  type ArenaRound,
} from '@/lib/arena/rounds'
import { PAGE_CONTAINER_CLASS, SECTION_TITLE_CLASS } from '@/lib/page-layout'

/**
 * One arena round. A closed set of rounds behind a dynamic segment: proxy.ts
 * enumerates ARENA_ROUND_SLUGS and answers an unknown one with a real 404, so
 * the notFound() below is only the belt for a direct render.
 */
export function generateStaticParams(): { round: string }[] {
  return ARENA_ROUNDS.map((r) => ({ round: r.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ round: string }>
}): Promise<Metadata> {
  const { round: slug } = await params
  const round = findRound(slug)
  if (!round) return {}
  return {
    title: `${round.title} · Arena · Skillet`,
    description: round.question,
    alternates: { canonical: roundHref(round.slug) },
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className={SECTION_TITLE_CLASS}>{title}</h2>
      {children}
    </section>
  )
}

function OpenPanel({ round }: { round: ArenaRound }) {
  return (
    <Panel
      as="section"
      className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div>
        <p className="text-lg font-semibold tracking-tight text-(--ink)">
          Voting closes {round.dates.closes}
        </p>
        <p className="mt-1 max-w-[52ch] text-sm text-(--ink-2)">
          {round.pairCount} pairs. Votes stay sealed until the round closes, then every one is
          published.
        </p>
      </div>
      <Button href={voteHref(round.slug)} size="lg" className="shrink-0">
        Vote
      </Button>
    </Panel>
  )
}

function UpcomingPanel({ round }: { round: ArenaRound }) {
  return (
    <Panel as="section" className="flex flex-col gap-2">
      <p className="text-lg font-semibold tracking-tight text-(--ink)">Locks {round.dates.locks}</p>
      {round.judge ? <p className="max-w-[60ch] text-(--ink-2)">{round.judge}</p> : null}
    </Panel>
  )
}

function Rules({ round }: { round: ArenaRound }) {
  const rows: Array<{ label: string; body: React.ReactNode }> =
    round.judgedBy === 'planted-bugs'
      ? [
          { label: 'Contracts', body: `${round.draw.count} ${round.draw.from}.` },
          {
            label: 'Plants',
            body: 'Three bugs per contract from a hidden list, published after the round.',
          },
          {
            label: 'Runs',
            body: 'Each version audits each contract 3 times. A bug counts as found in 2 of 3.',
          },
          {
            label: 'Bar',
            body: 'Finds significantly more planted bugs, with no more false alarms.',
          },
          {
            label: 'Entries',
            body: `${round.entries} versions. Every entry is listed, winners and losers.`,
          },
        ]
      : [
          {
            label: 'Briefs',
            body: `${round.draw.count} from ${round.draw.from}, drawn at block ${round.draw.block?.toLocaleString('en-US')} after both versions lock.`,
          },
          {
            label: 'Same run',
            body: 'Same model, tools and token budget for both. Only the skill differs.',
          },
          {
            label: 'Bar',
            body: (
              <>
                <span>
                  The challenger needs {neededFor(40)} of 40 decided pairs, ties left out. That's
                  when luck explains it less than 5% of the time.
                </span>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-(--ink-2) hover:text-(--ink)">
                    The bar at other counts
                  </summary>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {ARENA_BAR.map((row) => (
                      <li
                        key={row.decided}
                        className="rounded-lg border border-(--line) px-2.5 py-1 font-mono text-xs text-(--ink)"
                      >
                        {row.needed} of {row.decided}
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            ),
          },
          {
            label: 'Votes',
            body: 'Signed, sealed until close, then published. Pairs with a known answer drop careless votes.',
          },
          {
            label: 'Entries',
            body: `${round.entries} versions, one per author. Every entry is listed, winners and losers.`,
          },
        ]
  return (
    <Panel as="dl" padding="none" className="divide-y divide-(--line)">
      {rows.map((row) => (
        <div
          key={row.label}
          className="grid gap-1 px-5 py-4 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-4"
        >
          <dt className="font-semibold text-(--ink)">{row.label}</dt>
          <dd className="text-sm leading-relaxed text-(--ink-2)">{row.body}</dd>
        </div>
      ))}
    </Panel>
  )
}

export default async function RoundPage({ params }: { params: Promise<{ round: string }> }) {
  const { round: slug } = await params
  const round = findRound(slug)
  if (!round) notFound()

  return (
    <main className={`arena ${PAGE_CONTAINER_CLASS}`}>
      <div className="mx-auto flex max-w-[880px] flex-col gap-10">
        <header className="flex flex-col gap-4">
          <Link
            href="/arena"
            className="text-sm text-(--ink-2) transition-colors hover:text-(--ink)"
          >
            ← Arena
          </Link>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.06em] text-(--ink-2)">
              {round.network} · {round.area}
            </span>
            <StatusBadge round={round} />
          </div>
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-(--ink) sm:text-4xl">
              {round.title}
            </h1>
            <p className="mt-2 max-w-[60ch] text-lg text-(--ink-2)">{round.question}</p>
          </div>
          <PreviewNote />
        </header>

        <VersionCards round={round} />

        {round.status === 'open' ? <OpenPanel round={round} /> : null}
        {round.status === 'upcoming' ? <UpcomingPanel round={round} /> : null}
        {round.status === 'closed' && round.result ? (
          <RoundResult round={round} result={round.result} />
        ) : null}

        {round.juries.length > 0 ? (
          <Section title="Who votes">
            <JuryList round={round} />
            <p className="text-sm text-(--ink-2)">
              Only the jury decides. If holders disagree with it, the round is flagged instead of
              counted. Machines count once they agree with people as often as people agree with each
              other.
            </p>
          </Section>
        ) : null}

        <Section title="Rules">
          <Rules round={round} />
        </Section>

        {round.status === 'closed' && round.pairs.length > 0 ? (
          <Section title="Pairs">
            <PairsTable round={round} />
          </Section>
        ) : null}
      </div>
    </main>
  )
}
