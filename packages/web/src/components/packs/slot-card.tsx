'use client'

import { forwardRef, type CSSProperties } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Plus } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { SAMPLE_BRAND } from '@/lib/packs/data'
import type { PackSkill, PackSlot, Sample } from '@/lib/packs/types'
import s from './packs.module.css'

/**
 * A sample drawn as the thing it is: a post, an email, a page's hero, an ad.
 * On a card it clamps; in the tray it shows in full.
 */
// Whole lines that fit a card's sample window: phone deck, then desktop grid.
const LINES: Record<Sample['kind'], [number, number]> = { post: [9, 10], email: [8, 9], hero: [4, 4], ad: [7, 8] }

export function SampleView({ sample, full = false }: { sample: Sample; full?: boolean }) {
  const clamp = full ? undefined : s.clamp
  const [sm, lg] = LINES[sample.kind]
  const lines = { '--lines-sm': sm, '--lines-lg': lg } as CSSProperties
  switch (sample.kind) {
    case 'post':
      return (
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--pack)] text-xs font-bold text-[var(--pack-ink)]">
              {SAMPLE_BRAND.initial}
            </span>
            <span className="truncate text-sm font-bold">{SAMPLE_BRAND.name}</span>
          </div>
          <p className={cn('mt-2 text-sm leading-[1.5] whitespace-pre-line text-pretty', clamp)} style={lines}>
            {sample.text}
          </p>
        </div>
      )
    case 'email':
      return (
        <div>
          <p className="text-sm leading-[1.4] font-bold text-pretty">{sample.subject}</p>
          <p
            className={cn('mt-1.5 text-sm leading-[1.5] whitespace-pre-line text-pretty text-[var(--p-ink-2)]', clamp)}
            style={lines}
          >
            {sample.body}
          </p>
        </div>
      )
    case 'hero':
      return (
        <div>
          <p className="text-xl leading-[1.15] font-bold tracking-[-0.02em] text-balance">{sample.headline}</p>
          <p className="mt-2 text-sm leading-[1.5] text-pretty text-[var(--p-ink-2)]">{sample.sub}</p>
          <span className="mt-3 inline-flex max-w-full rounded-full bg-[var(--pack)] px-3 py-1.5 text-xs font-bold whitespace-nowrap text-[var(--pack-ink)]">
            {sample.button}
          </span>
        </div>
      )
    case 'ad':
      return (
        <div>
          <p className="text-xs font-medium text-[var(--p-ink-2)]">Sponsored · {SAMPLE_BRAND.name}</p>
          <p className="mt-1.5 text-sm leading-[1.4] font-bold text-pretty">{sample.headline}</p>
          <p className={cn('mt-1 text-sm leading-[1.5] text-pretty', clamp)} style={lines}>
            {sample.body}
          </p>
        </div>
      )
  }
}

/** A swipeable deck on a phone, a grid cell on a desktop; one height each. */
const CARD_SIZE = 'h-[380px] w-[78vw] max-w-[320px] shrink-0 snap-center sm:h-[400px] sm:w-auto sm:max-w-none'

function SkillLine({ skill }: { skill: PackSkill }) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-4 pt-3 pb-3.5 text-sm">
      <Avatar
        src={skill.avatarUrl}
        name={skill.maker}
        colorKey={skill.makerHandle}
        kind="person"
        size="xxs"
        aria-hidden="true"
      />
      <span className="truncate font-medium">{skill.name}</span>
      <span className="ml-auto shrink-0 text-[var(--p-ink-2)] max-sm:hidden">{skill.maker}</span>
    </div>
  )
}

/**
 * One slot, as a card: the job on top, what its skill wrote in the middle, the
 * skill and its maker at the foot. The back is the pack's foil, so a card dealt
 * face down flips to show what it does. The title is the button.
 */
export const SlotCard = forwardRef<
  HTMLDivElement,
  { slot: PackSlot; index: number; total: number; face: 'front' | 'back'; onOpen: () => void; disabled?: boolean }
>(function SlotCard({ slot, index, total, face, onOpen, disabled }, ref) {
  return (
    <div ref={ref} className={cn(s.card, CARD_SIZE)} data-face={face}>
      <div className={s.cardInner} data-inner="">
        <div className={cn(s.face, s.front)}>
          <div className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-2.5">
            <h3 className="text-xl leading-[1.2] font-bold tracking-[-0.02em] text-balance">
              <button type="button" className={s.stretch} onClick={onOpen} disabled={disabled}>
                {slot.job}
              </button>
            </h3>
            <span className="mt-1 shrink-0 font-mono text-xs text-[var(--p-ink-2)]">
              {index + 1}/{total}
            </span>
          </div>
          <div className={s.art}>
            <SampleView sample={slot.sample} />
          </div>
          <SkillLine skill={slot.skill} />
        </div>
        <div className={cn(s.face, s.back)} aria-hidden="true">
          <span className="site-logo-mark" />
          <span className="mt-1 text-sm font-bold">Skillet</span>
        </div>
      </div>
    </div>
  )
})

/** The slot that comes empty: your own skill goes here. */
export const OwnSlotCard = forwardRef<
  HTMLDivElement,
  { added: { name: string; maker: string } | null; onOpen: () => void; disabled?: boolean }
>(function OwnSlotCard({ added, onOpen, disabled }, ref) {
  return (
    <div ref={ref} className={cn(s.card, CARD_SIZE)} data-own="">
      <div className={s.cardInner}>
        {added ? (
          <div className={cn(s.face, s.front, 'relative')}>
            <div className="px-4 pt-3.5 pb-2.5">
              <h3 className="text-xl leading-[1.2] font-bold tracking-[-0.02em]">
                <button type="button" className={s.stretch} onClick={onOpen} disabled={disabled}>
                  Your slot
                </button>
              </h3>
            </div>
            <div className={cn(s.art, 'flex flex-col justify-end')}>
              <p className="text-xl leading-[1.15] font-bold tracking-[-0.02em] text-balance">{added.name}</p>
              <p className="mt-1 text-sm text-[var(--p-ink-2)]">Its first sample shows after its first run.</p>
            </div>
            <div className="flex items-center gap-2 px-4 pt-3 pb-3.5 text-sm">
              <span className="truncate font-medium">{added.maker}</span>
            </div>
          </div>
        ) : (
          <div className={cn(s.slot, 'relative flex h-full flex-col items-center justify-center gap-2 p-5 text-center')}>
            <Plus className="h-6 w-6 text-[var(--p-ink-2)]" />
            <h3 className="text-xl leading-[1.2] font-bold tracking-[-0.02em]">
              <button type="button" className={s.stretch} onClick={onOpen} disabled={disabled}>
                Your slot
              </button>
            </h3>
            <p className="max-w-[22ch] text-sm leading-[1.4] text-[var(--p-ink-2)]">Add a skill you already use.</p>
          </div>
        )}
      </div>
    </div>
  )
})
