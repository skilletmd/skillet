'use client'

import { PACKS } from '@/lib/packs/data'
import { PackArt } from '../pack-art'
import { PhonePage, packStyles as s } from './ideas-ui'
import { cn } from '@/lib/cn'

/** Idea 1 as its phone first screen, for the board. The full page is /packs. */
export function PacksPhone() {
  return (
    <PhonePage>
      <h1 className="mt-4 text-4xl leading-[1.05] font-bold tracking-[-0.045em] text-balance">Teach your AI a job</h1>
      <p className="mt-2 text-base leading-[1.5] text-pretty text-[var(--p-ink-2)]">
        Each pack is a set of skills for one kind of work. Open one to see what every skill writes.
      </p>
      <ul className="-mx-4 mt-6 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pb-6">
        {PACKS.map((p) => (
          <li key={p.id} className="shrink-0 snap-start">
            <PackArt pack={p} live={p.slots.length > 0} width={236} />
          </li>
        ))}
      </ul>
      <a href="/packs" target="_top" className={cn(s.pill, s.pillPrimary)}>
        Open pack
      </a>
    </PhonePage>
  )
}
