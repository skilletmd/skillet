'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState, type CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import { JOBS, PRESETS, jobById } from '@/lib/packs/ideas'
import { KitTile, PhonePage, ideaStyles as i, packStyles as s } from './ideas-ui'

/** Which preset first holds a job decides the colour its slot wears. */
function colorOf(jobId: string) {
  const preset = PRESETS.find((p) => p.jobs.includes(jobId)) ?? PRESETS[0]
  return { color: preset.color, ink: preset.ink }
}

/**
 * Idea 2, Build: no catalog at all. You say what you hand to AI, and each job
 * you tap becomes a slot that fills itself with the skill for that job. The
 * packs survive as one-tap presets.
 */
export function BuildIdea() {
  const reduce = useReducedMotion()
  const [picked, setPicked] = useState<string[]>(['tweets', 'cold-emails', 'landing-pages', 'decks'])
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return (
    <PhonePage
      footer={
        <button type="button" className={cn(s.pill, s.pillPrimary, 'w-full')} disabled={picked.length === 0}>
          {picked.length === 0 ? 'Tap a job to start' : `Add ${picked.length} skills to Claude`}
        </button>
      }
    >
      <h1 className="mt-4 text-4xl leading-[1.05] font-bold tracking-[-0.045em] text-balance">
        What do you hand to AI?
      </h1>
      <p className="mt-2 text-base leading-[1.5] text-pretty text-[var(--p-ink-2)]">
        Tap what you do. Each job gets one skill, already picked.
      </p>

      <div className="-mx-4 mt-5 flex gap-2 overflow-x-auto px-4 pb-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={i.chip}
            aria-pressed={p.jobs.length === picked.length && p.jobs.every((j) => picked.includes(j))}
            onClick={() => setPicked(p.jobs)}
          >
            <span
              aria-hidden="true"
              className="h-3.5 w-2.5 rounded-[3px]"
              style={{ background: p.color } as CSSProperties}
            />
            {p.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {JOBS.map((j) => (
          <button
            key={j.id}
            type="button"
            className={i.chip}
            aria-pressed={picked.includes(j.id)}
            onClick={() => toggle(j.id)}
          >
            {j.label}
          </button>
        ))}
      </div>

      <h2 className="mt-8 flex items-baseline gap-2 text-xl font-bold tracking-[-0.02em]">
        Your kit
        <span className="text-sm font-normal text-[var(--p-ink-2)]">
          {picked.length} {picked.length === 1 ? 'job' : 'jobs'}
        </span>
      </h2>
      <motion.div layout={!reduce} className="mt-3 grid grid-cols-2 gap-3">
        <AnimatePresence initial={false} mode="popLayout">
          {picked.map((id) => {
            const job = jobById(id)
            if (!job) return null
            const { color, ink } = colorOf(id)
            return (
              <motion.div
                key={id}
                layout={!reduce}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.92, transition: { duration: 0.15 } }}
                transition={{ type: 'spring', duration: 0.45, bounce: 0.2 }}
              >
                <KitTile job={job.label} skill={job.skill} sample={job.sample} color={color} ink={ink} />
              </motion.div>
            )
          })}
        </AnimatePresence>
        {picked.length === 0 && (
          <div className={cn(i.empty, 'col-span-2 text-sm')}>Your slots show up here.</div>
        )}
      </motion.div>
    </PhonePage>
  )
}
