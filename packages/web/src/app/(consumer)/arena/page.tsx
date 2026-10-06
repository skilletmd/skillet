import type { Metadata } from 'next'
import { PageHeader } from '@/components/page-header'
import { HowRoundsWork, PreviewNote, RoundCard } from '@/components/arena/arena-ui'
import { ARENA_ROUNDS, type ArenaStatus } from '@/lib/arena/rounds'
import { PAGE_CONTAINER_CLASS, SECTION_TITLE_CLASS } from '@/lib/page-layout'

export const metadata: Metadata = {
  title: 'Arena · Skillet',
  description:
    'Two versions of a skill do the same real work. People pick the better result blind, and every vote is published.',
  alternates: { canonical: '/arena' },
}

// Open rounds first (something to do now), then what's coming, then results.
const ORDER: Record<ArenaStatus, number> = { open: 0, upcoming: 1, closed: 2 }

export default function ArenaPage() {
  const rounds = [...ARENA_ROUNDS].sort((x, y) => ORDER[x.status] - ORDER[y.status])
  return (
    <main className={`arena ${PAGE_CONTAINER_CLASS}`}>
      <div className="mx-auto max-w-[880px]">
        <PageHeader
          title="Arena"
          lede="Two versions of a skill do the same real work. People pick the better result without knowing which is which, and every vote is published."
        />
        <PreviewNote />

        <div className="mt-8 grid gap-4">
          {rounds.map((round) => (
            <RoundCard key={round.slug} round={round} />
          ))}
        </div>

        <section className="mt-14 border-t border-(--line) pt-8">
          <h2 className={SECTION_TITLE_CLASS}>How a round works</h2>
          <div className="mt-5">
            <HowRoundsWork />
          </div>
        </section>
      </div>
    </main>
  )
}
