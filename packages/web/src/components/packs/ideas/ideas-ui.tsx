'use client'

import Link from 'next/link'
import type { CSSProperties, ReactNode } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/cn'
import type { PackSkill } from '@/lib/packs/types'
import s from '../packs.module.css'
import i from './ideas.module.css'

/** One idea, drawn as a phone screen: the packs tokens, a header, a pinned action. */
export function PhonePage({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className={cn(s.tokens, s.page)}>
      <header className="mx-auto flex max-w-[480px] items-center justify-between px-4 py-3">
        <Link
          href="/packs/ideas"
          target="_top"
          className="site-brand-link flex items-center font-mono text-base font-bold"
        >
          <span className="site-logo-mark" aria-hidden="true" />
          Skillet
        </Link>
        <ThemeToggle />
      </header>
      <main className={cn('mx-auto max-w-[480px] px-4', footer ? 'pb-32' : 'pb-12')}>{children}</main>
      {footer && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--p-line)] bg-[var(--p-bg)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-[448px]">{footer}</div>
        </div>
      )}
    </div>
  )
}

export function SkillBy({ skill, extra, maker = true }: { skill: PackSkill; extra?: ReactNode; maker?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-sm">
      <Avatar
        src={skill.avatarUrl}
        name={skill.maker}
        colorKey={skill.makerHandle}
        kind="person"
        size="xxs"
        aria-hidden="true"
      />
      <span className="truncate font-medium">{skill.name}</span>
      {extra ?? (maker && <span className="truncate text-[var(--p-ink-2)]">{skill.maker}</span>)}
    </div>
  )
}

/** A filled slot: the job on a coloured band, what the skill writes, the skill. */
export function KitTile({
  job,
  skill,
  sample,
  color,
  ink,
  footer,
}: {
  job: string
  skill: PackSkill
  sample?: string
  color: string
  ink: string
  footer?: ReactNode
}) {
  return (
    <div className={i.tile} style={{ '--tile': color, '--tile-ink': ink } as CSSProperties}>
      <div className={i.tileTop}>
        <p className="text-base leading-[1.2] font-bold tracking-[-0.01em] text-balance">{job}</p>
      </div>
      <div className="flex flex-1 flex-col justify-between gap-3 p-3.5">
        <p
          className={cn(
            'line-clamp-3 text-sm leading-[1.45] text-pretty',
            sample ? 'text-[var(--p-ink)]' : 'text-[var(--p-ink-2)]',
          )}
        >
          {sample ?? skill.description}
        </p>
        {/* A tile is too narrow for both names; the avatar says who made it. */}
        {footer ?? <SkillBy skill={skill} maker={false} />}
      </div>
    </div>
  )
}

export { i as ideaStyles, s as packStyles }
