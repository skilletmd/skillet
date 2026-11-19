'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/cn'
import { humanizeSlug } from '@/lib/humanize-slug'
import { KIT_SLOTS, type KitSlot, type SlotSkill } from '@/lib/arena/slots'
import { PhonePage, ideaStyles as i, packStyles as s } from './ideas-ui'

const nameOf = (k: SlotSkill) => k.name ?? humanizeSlug(k.slug)
const runsText = (n: number) => (n === 0 ? 'Never ran' : n === 1 ? '1 run' : `${n} runs`)

/** What a job keeps once tidied: the merged skill, or the skills that ran. */
function kept(slot: KitSlot): SlotSkill[] {
  if (slot.merge) return [slot.merge.result]
  const used = slot.skills.filter((k) => k.runs > 0)
  return used.length > 0 ? used : slot.skills.slice(0, 1)
}

/**
 * Idea 3, Tidy: start from what you already have. Your skills land in the job
 * they do; where several fight over one job they fan out like a hand of cards,
 * and one tap folds each hand down to the one that earns its place.
 */
export function TidyIdea() {
  const reduce = useReducedMotion()
  const [tidy, setTidy] = useState(false)
  const crowded = KIT_SLOTS.filter((sl) => sl.skills.length > 1)
  const singles = KIT_SLOTS.filter((sl) => sl.skills.length === 1)
  const before = KIT_SLOTS.reduce((n, sl) => n + sl.skills.length, 0)
  const after = KIT_SLOTS.reduce((n, sl) => n + kept(sl).length, 0)
  const neverRan = KIT_SLOTS.reduce((n, sl) => n + sl.skills.filter((k) => k.runs === 0).length, 0)

  const stats = [
    { n: tidy ? after : before, label: 'skills' },
    { n: KIT_SLOTS.length, label: 'jobs' },
    { n: tidy ? 0 : neverRan, label: 'never ran' },
  ]

  return (
    <PhonePage
      footer={
        tidy ? (
          <div className="grid grid-cols-[auto_1fr] gap-2">
            <button type="button" className={cn(s.pill, s.pillSecondary, 'min-w-0')} onClick={() => setTidy(false)}>
              Undo
            </button>
            <button type="button" className={cn(s.pill, s.pillPrimary, 'min-w-0')}>
              Sync {after} skills
            </button>
          </div>
        ) : (
          <button type="button" className={cn(s.pill, s.pillPrimary, 'w-full')} onClick={() => setTidy(true)}>
            Tidy up: {before} to {after} skills
          </button>
        )
      }
    >
      <h1 className="mt-4 text-4xl leading-[1.05] font-bold tracking-[-0.045em] text-balance">Your skills, sorted</h1>
      <p className="mt-2 text-base leading-[1.5] text-pretty text-[var(--p-ink-2)]">
        Every skill on this Mac, in the job it does. Runs are from the last 30 days.
      </p>

      <dl className="mt-6 grid grid-cols-3 gap-3">
        {stats.map((st) => (
          <div key={st.label}>
            <dt className="sr-only">{st.label}</dt>
            <dd>
              <span className="block text-3xl leading-none font-bold tracking-[-0.04em] tabular-nums">{st.n}</span>
              <span className="mt-1.5 block text-sm text-[var(--p-ink-2)]">{st.label}</span>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-7 flex flex-col gap-3">
        {crowded.map((slot) => {
          const keep = kept(slot)
          const shown = tidy ? keep : slot.skills
          return (
            <section key={slot.job} className={cn(i.tile, 'min-h-0 p-4')}>
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-base font-bold tracking-[-0.01em]">{slot.job}</h2>
                <span className="text-sm text-[var(--p-ink-2)]">
                  {tidy
                    ? slot.merge
                      ? `Merged from ${slot.skills.length}`
                      : `Removed ${slot.skills.length - keep.length}`
                    : `${slot.skills.length} skills, one job`}
                </span>
              </div>
              {/* Side by side, never overlapping, so every name reads. The ones
                  that never ran sit at half strength and say so. */}
              <div className="mt-3 flex flex-wrap gap-2">
                <AnimatePresence initial={false} mode="popLayout">
                  {shown.map((k) => (
                    <motion.div
                      key={`${k.author}/${k.slug}/${tidy && slot.merge ? 'merged' : 'own'}`}
                      layout={!reduce}
                      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.94 }}
                      animate={{ opacity: k.runs === 0 && !tidy ? 0.55 : 1, y: 0, scale: 1 }}
                      exit={reduce ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.9, transition: { duration: 0.18 } }}
                      transition={{ type: 'spring', duration: 0.5, bounce: 0.15 }}
                      className="flex min-w-[128px] flex-col rounded-2xl border border-[var(--p-line)] bg-[var(--p-surface)] px-3 py-2.5"
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Avatar
                          src={k.avatarUrl}
                          name={k.authorName}
                          colorKey={k.author}
                          kind="person"
                          size="xxs"
                          aria-hidden="true"
                        />
                        <span className="text-sm font-bold">{nameOf(k)}</span>
                      </span>
                      <span className="mt-1 text-sm text-[var(--p-ink-2)] tabular-nums">
                        {tidy && slot.merge ? 'New' : runsText(k.runs)}
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )
        })}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        {singles.map((slot) => {
          const k = slot.skills[0]
          return (
            <section key={slot.job} className={cn(i.tile, 'min-h-0 justify-between gap-3 p-3.5')}>
              <h2 className="text-base leading-[1.2] font-bold tracking-[-0.01em] text-balance">{slot.job}</h2>
              <div>
                <p className="truncate text-sm font-medium">{nameOf(k)}</p>
                <p className="text-sm text-[var(--p-ink-2)] tabular-nums">{runsText(k.runs)}</p>
              </div>
            </section>
          )
        })}
      </div>
    </PhonePage>
  )
}
