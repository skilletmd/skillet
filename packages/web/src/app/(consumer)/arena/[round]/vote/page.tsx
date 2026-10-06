import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { PreviewNote } from '@/components/arena/arena-ui'
import { VoteFlow } from '@/components/arena/vote-flow'
import { ARENA_ROUNDS, findRound, roundHref } from '@/lib/arena/rounds'
import { PAGE_CONTAINER_CLASS } from '@/lib/page-layout'

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
    title: `Vote · ${round.title} · Skillet`,
    description: round.question,
    alternates: { canonical: `${roundHref(round.slug)}/vote` },
    robots: { index: false },
  }
}

export default async function VotePage({ params }: { params: Promise<{ round: string }> }) {
  const { round: slug } = await params
  const round = findRound(slug)
  if (!round) notFound()

  const votable = round.status === 'open' && round.pairs.every((p) => p.shots)

  return (
    <main className={PAGE_CONTAINER_CLASS}>
      <div className="flex flex-col gap-6">
        <PreviewNote>Preview. Your picks stay on this page and aren't sent anywhere.</PreviewNote>
        {votable ? (
          <VoteFlow
            roundTitle={round.title}
            roundHref={roundHref(round.slug)}
            closes={round.dates.closes ?? ''}
            pairs={round.pairs}
          />
        ) : (
          <Panel className="mx-auto flex w-full max-w-[560px] flex-col items-start gap-3">
            <p className="text-lg font-semibold tracking-tight text-(--ink)">
              {round.status === 'upcoming' ? `Voting hasn't opened` : 'Voting is closed'}
            </p>
            <p className="text-(--ink-2)">
              {round.judgedBy === 'planted-bugs'
                ? 'This round is judged by planted bugs. Nobody votes.'
                : round.status === 'closed'
                  ? 'The results and every vote are on the round page.'
                  : `It opens when the round locks on ${round.dates.locks}.`}
            </p>
            <Button href={roundHref(round.slug)} variant="secondary">
              Go to the round
            </Button>
          </Panel>
        )}
      </div>
    </main>
  )
}
