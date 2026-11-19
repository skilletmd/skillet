'use client'

import { useState, type CSSProperties } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/cn'
import { KIT_SLOTS, SLOTS_KIT } from '@/lib/arena/slots'
import { DRAFTS } from '@/lib/arena/slots-drafts'
import { PACKS } from '@/lib/packs/data'
import { LEARNED_RULES } from '@/lib/packs/ideas'
import { Tray } from '../tray'
import { PhonePage, ideaStyles as i, packStyles as s } from './ideas-ui'

const WRITING = PACKS[0]

/**
 * Idea 4, Level up: your kit is your AI, and each slot gets better at your
 * work. It learns rules from your edits, and a new version only replaces the
 * old one after you pick it blind. The duel is the reason to come back.
 */
export function LevelIdea() {
  const [duel, setDuel] = useState(false)
  const rows = KIT_SLOTS.map((sl) => ({ job: sl.job, runs: sl.skills.reduce((n, k) => n + k.runs, 0) }))
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 6)
  const max = rows[0]?.runs || 1
  const total = KIT_SLOTS.reduce((n, sl) => n + sl.skills.reduce((m, k) => m + k.runs, 0), 0)
  const skills = KIT_SLOTS.reduce((n, sl) => n + sl.skills.length, 0)

  return (
    <PhonePage>
      <div className="mt-4 flex items-center gap-3.5">
        <Avatar src={SLOTS_KIT.ownerAvatar} name={SLOTS_KIT.ownerName} colorKey="taylor" kind="person" size="md" />
        <div className="min-w-0">
          <h1 className="text-3xl leading-[1.05] font-bold tracking-[-0.04em]">Taylor&apos;s AI</h1>
          <p className="mt-1 text-sm text-[var(--p-ink-2)] tabular-nums">
            {skills} skills · {total} runs in 30 days
          </p>
        </div>
      </div>

      <section
        className="mt-6 rounded-[28px] p-5"
        style={{ background: WRITING.color, color: WRITING.ink, '--pack': WRITING.color } as CSSProperties}
      >
        <p className="text-sm font-medium">Writing</p>
        <h2 className="mt-1 text-xl leading-[1.2] font-bold tracking-[-0.02em] text-balance">
          Learned 11 rules from your edits
        </h2>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm">
          {LEARNED_RULES.map((rule) => (
            <li key={rule} className="flex gap-2">
              <span aria-hidden="true">+</span>
              {rule}
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="max-w-[24ch] text-sm leading-[1.4]">A new version is ready. Pick it blind against the old one.</p>
          <button
            type="button"
            onClick={() => setDuel(true)}
            className={cn(s.pill, 'h-11 min-w-0 shrink-0 bg-white px-5 text-(--pack)')}
          >
            Duel
          </button>
        </div>
      </section>

      <h2 className="mt-8 text-xl font-bold tracking-[-0.02em]">Where it works</h2>
      <ul className="mt-4 flex flex-col gap-4">
        {rows.map((row, n) => (
          <li key={row.job}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium">{row.job}</span>
              <span className="text-[var(--p-ink-2)] tabular-nums">{row.runs} runs</span>
            </div>
            <div className={cn(i.bar, 'mt-2')}>
              <div
                className={i.barFill}
                style={{ width: `${(row.runs / max) * 100}%`, '--d': `${n * 60}ms` } as CSSProperties}
              />
            </div>
          </li>
        ))}
      </ul>

      <DuelTray open={duel} onClose={() => setDuel(false)} />
    </PhonePage>
  )
}

/** Round 1's tweet pair, already revealed to Taylor, so this duel spoils nothing still blind. */
function DuelTray({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [picked, setPicked] = useState<'a' | 'b' | null>(null)
  // A is the new version, B is today's skills.
  const drafts = { a: DRAFTS.tweetMerged, b: DRAFTS.tweetToday }
  const close = () => {
    onClose()
    window.setTimeout(() => setPicked(null), 260)
  }
  return (
    <Tray
      open={open}
      onOpenChange={(o) => !o && close()}
      title="Duel: Writing"
      style={{ '--pack': WRITING.color, '--pack-ink': WRITING.ink } as CSSProperties}
    >
      <p className="text-sm text-[var(--p-ink-2)]">
        One tweet: IMD's swarm is #1 on Paradigm's Prediction Market puzzle.
      </p>
      <div className="mt-4 flex flex-col gap-2.5">
        {(['a', 'b'] as const).map((side) => (
          <button
            key={side}
            type="button"
            disabled={picked !== null}
            onClick={() => setPicked(side)}
            className={cn(
              'rounded-2xl border p-4 text-left transition-[border-color,opacity] duration-200',
              picked === side ? 'border-[var(--p-ink)]' : 'border-[var(--p-line)]',
              picked !== null && picked !== side && 'opacity-55',
            )}
          >
            <span className="text-sm font-bold">
              {picked === null ? side.toUpperCase() : side === 'a' ? 'New version' : 'Old version'}
            </span>
            <span className="mt-2 block text-sm leading-[1.5] whitespace-pre-line">{drafts[side]}</span>
          </button>
        ))}
      </div>
      <div className="mt-4">
        {picked === null ? (
          <p className="text-center text-sm text-[var(--p-ink-2)]">Tap the one you&apos;d post.</p>
        ) : (
          <button type="button" className={cn(s.pill, s.pillPrimary, 'w-full')} onClick={close}>
            {picked === 'a' ? 'Use the new version' : 'Keep the old one'}
          </button>
        )}
      </div>
    </Tray>
  )
}
