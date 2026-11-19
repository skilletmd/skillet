'use client'

import { useState, type CSSProperties } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Check } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { PEOPLE_KITS } from '@/lib/packs/ideas'
import { PhonePage, ideaStyles as i, packStyles as s } from './ideas-ui'

/**
 * Idea 5, People: start from someone whose work you trust. Every kit is a
 * person's lineup, one skill per job; copy it, then swap any slot. The kit
 * link is what makers share, the way Bluesky starter packs spread.
 */
export function PeopleIdea() {
  const [copied, setCopied] = useState<string | null>(null)
  const kit = PEOPLE_KITS.find((k) => k.maker.handle === copied)

  return (
    <PhonePage
      footer={
        <button type="button" className={cn(s.pill, s.pillPrimary, 'w-full')} disabled={!kit}>
          {kit ? `Add ${kit.maker.name.split(' ')[0]}'s ${kit.slots.length} skills to Claude` : 'Copy a kit to start'}
        </button>
      }
    >
      <h1 className="mt-4 text-4xl leading-[1.05] font-bold tracking-[-0.045em] text-balance">
        Start from someone&apos;s kit
      </h1>
      <p className="mt-2 text-base leading-[1.5] text-pretty text-[var(--p-ink-2)]">
        Copy the kit of someone whose work you trust. Swap any slot later.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {PEOPLE_KITS.map((k) => {
          const isCopied = copied === k.maker.handle
          return (
            <article
              key={k.maker.handle}
              className={cn(i.tile, 'min-h-0')}
              style={{ '--tile': k.color, '--tile-ink': k.ink } as CSSProperties}
            >
              <div className={cn(i.tileTop, 'flex items-center gap-3 px-4 py-3.5')}>
                <Avatar
                  src={k.maker.avatarUrl}
                  name={k.maker.name}
                  colorKey={k.maker.handle}
                  kind="person"
                  size="md"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-xl leading-[1.15] font-bold tracking-[-0.02em]">{k.maker.name}</h2>
                  <p className="text-sm">
                    {k.name} · {k.maker.stars} stars
                  </p>
                </div>
              </div>
              <div className="flex items-end justify-between gap-3 p-4">
                <ul className="flex min-w-0 flex-wrap gap-1.5">
                  {k.slots.map((sl) => (
                    <li
                      key={sl.job}
                      className="rounded-full border border-[var(--p-line)] px-2.5 py-1 text-sm whitespace-nowrap"
                    >
                      {sl.job}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  aria-pressed={isCopied}
                  onClick={() => setCopied(isCopied ? null : k.maker.handle)}
                  className={cn(s.pill, isCopied ? s.pillPrimary : s.pillSecondary, 'h-10 min-w-[88px] shrink-0 px-4 text-sm')}
                >
                  {isCopied ? (
                    <>
                      <Check className="h-4 w-4" />
                      Copied
                    </>
                  ) : (
                    'Copy'
                  )}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </PhonePage>
  )
}
