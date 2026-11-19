'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { Plus } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import i from './ideas/ideas.module.css'
import k from './kit.module.css'
import s from './packs.module.css'

/**
 * The pieces every kit map shares, whoever's kit it is: the section card, the
 * job chip, the strip of squares, and the count. Taylor's kit (/packs/kit) and
 * the homepage (/packs/home) both draw with these, so the two read as one map.
 */

export interface Hue {
  color: string
  ink: string
}

export const secVars = (sec: Hue) =>
  ({ '--tile': sec.color, '--tile-ink': sec.ink, '--pack': sec.color, '--pack-ink': sec.ink }) as CSSProperties

/** Stagger for a fill: the nth job to land waits this long. */
export const landDelay = (n: number) => ({ '--d': `${Math.min(n, 40) * 18}ms` }) as CSSProperties

/** One section: its colour band and name (the name opens it), then its jobs. */
export function SectionCard({
  sec,
  label,
  onOpen,
  children,
}: {
  sec: Hue & { name: string }
  label: ReactNode
  onOpen: () => void
  children: ReactNode
}) {
  return (
    <section className={cn(i.tile, k.section, 'relative min-h-0')} style={secVars(sec)}>
      <div className={cn(i.tileTop, 'flex items-baseline justify-between gap-3 px-4')}>
        <h2 className="text-xl leading-[1.2] font-bold tracking-[-0.02em]">
          <button type="button" className={s.stretch} onClick={onOpen}>
            {sec.name}
          </button>
        </h2>
        <span className="text-sm font-medium tabular-nums">{label}</span>
      </div>
      <ul className="flex flex-wrap gap-1.5 p-3.5">{children}</ul>
    </section>
  )
}

/** A job: dashed with a plus while empty, the skill maker's face once filled. */
export function JobChip({
  job,
  filled,
  avatar,
  extra,
  className,
  style,
}: {
  job: string
  filled: boolean
  avatar?: { src: string | null; name: string }
  /** A count after the job: extras waiting to be combined, or a slot's many. */
  extra?: ReactNode
  className?: string
  style?: CSSProperties
}) {
  if (!filled) {
    return (
      <li
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-full border border-dashed border-[color-mix(in_srgb,var(--p-ink-2)_45%,transparent)] px-3 text-sm text-[var(--p-ink-2)]',
          className,
        )}
        style={style}
      >
        <Plus className="h-3.5 w-3.5" />
        {job}
      </li>
    )
  }
  return (
    <li
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--p-line)] bg-[var(--p-surface)] pr-3 pl-1 text-sm font-medium',
        className,
      )}
      style={style}
    >
      {avatar && (
        <Avatar src={avatar.src} name={avatar.name} colorKey={avatar.name} kind="person" size="xxs" aria-hidden="true" />
      )}
      {job}
      {extra}
    </li>
  )
}

export interface StripGroup {
  id: string
  color: string
  cells: { key: string; filled: boolean; /** Set when this cell just filled: its place in the wave. */ wave?: number }[]
}

/** The whole map at a glance: one square per job, coloured once filled. */
export function Coverage({ groups, label, className }: { groups: StripGroup[]; label: string; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-x-3 gap-y-2', className)} role="img" aria-label={label}>
      {groups.map((g) => (
        <span key={g.id} className="flex gap-1">
          {g.cells.map((c) => (
            <span
              key={`${c.key}-${c.filled}`}
              className={cn('h-3.5 w-3.5 rounded-[4px] transition-colors duration-300', c.filled && c.wave !== undefined && k.cellOn)}
              style={
                c.filled
                  ? { background: g.color, ...(c.wave !== undefined ? landDelay(c.wave) : {}) }
                  : { boxShadow: 'inset 0 0 0 1.5px color-mix(in srgb, var(--p-ink-2) 40%, transparent)' }
              }
            />
          ))}
        </span>
      ))}
    </div>
  )
}

/** A number that counts its way to a new value instead of jumping. */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = from.current
    if (start === value) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const span = Math.abs(value - start)
    const duration = reduce ? 0 : Math.min(350, 160 + span * 8)
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = duration === 0 ? 1 : Math.min(1, (now - t0) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      const next = Math.round(start + (value - start) * eased)
      setShown(next)
      from.current = next
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <span className="tabular-nums">{shown}</span>
}

/**
 * A skill: who made it, its name, and a trailing note. Long names wrap under
 * the name rather than cut off, and a public skill's name links to its page.
 */
export function SkillLine({
  avatarUrl,
  by,
  name,
  note,
  href,
}: {
  avatarUrl: string | null
  by: string
  name: string
  note?: string
  href?: string
}) {
  return (
    <p className="mt-1 flex min-w-0 items-start gap-1.5 text-sm leading-5">
      <Avatar src={avatarUrl} name={by} colorKey={by} kind="person" size="xxs" aria-hidden="true" className="shrink-0" />
      <span className="min-w-0">
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-medium underline decoration-transparent underline-offset-4 transition-colors hover:decoration-[var(--p-ink-2)]"
          >
            {name}
          </a>
        ) : (
          <span className="font-medium">{name}</span>
        )}{' '}
        <span className="text-[var(--p-ink-2)]">{note ? `${by} · ${note}` : by}</span>
      </span>
    </p>
  )
}
