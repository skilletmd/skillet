'use client'

import Link from 'next/link'
import { useState, type FormEvent } from 'react'
import { ThemeToggle } from '@/components/theme-toggle'
import { Avatar } from '@/components/ui/avatar'
import { Check, Plus } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { humanizeSlug } from '@/lib/humanize-slug'
import {
  PICKS,
  TAKE_MARKETING,
  TAYLOR_KIT,
  TAYLOR_TOOLS,
  sortSkillLink,
  type MapSection,
  type MapSkill,
  type MapSlot,
} from '@/lib/packs/kit-map'
import { Coverage, JobChip, SectionCard, SkillLine, secVars } from './kit-parts'
import s from './packs.module.css'
import { Tray } from './tray'

const TAYLOR_AVATAR = TAYLOR_KIT[0].slots[0].skills[0].avatarUrl
const isFilled = (sl: MapSlot) => sl.skills.length > 0
const hasExtras = (sl: MapSlot) => !sl.many && sl.skills.length > 1
const filledCount = (sec: MapSection) => sec.slots.filter(isFilled).length
const runsText = (n: number) => (n === 0 ? 'never ran' : n === 1 ? '1 run' : `${n} runs`)

/**
 * The kit framework, drawn: every kind of work is a section, every job in it a
 * slot. Filled slots carry the skill, empty ones show what's missing, and a
 * slot holding two skills offers to combine them. Your real skills, placed.
 */
export function KitMap() {
  const [sections, setSections] = useState<MapSection[]>(TAYLOR_KIT)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [copied, setCopied] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)

  const total = sections.reduce((n, sec) => n + sec.slots.length, 0)
  const filled = sections.reduce((n, sec) => n + filledCount(sec), 0)
  const all = [...sections, TAYLOR_TOOLS]
  const openSec = all.find((sec) => sec.id === openId) ?? null

  const updateSlot = (secId: string, job: string, next: (sl: MapSlot) => MapSlot) => {
    setSections((prev) =>
      prev.map((sec) => (sec.id !== secId ? sec : { ...sec, slots: sec.slots.map((sl) => (sl.job === job ? next(sl) : sl)) })),
    )
    setFresh(`${secId}/${job}`)
  }

  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/packs/kit`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={cn(s.tokens, s.page)}>
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-4 py-3 sm:px-8">
        <Link href="/" className="site-brand-link flex items-center font-mono text-base font-bold">
          <span className="site-logo-mark" aria-hidden="true" />
          Skillet
        </Link>
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-[1120px] px-4 pt-4 pb-32 sm:px-8 sm:pt-8 sm:pb-16">
        <div className="flex items-end justify-between gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <Avatar src={TAYLOR_AVATAR} name="Taylor" colorKey="taylor" kind="person" size="md" />
            <div className="min-w-0">
              <h1 className="text-4xl leading-[1.05] font-bold tracking-[-0.045em]">Taylor&apos;s kit</h1>
              <p className="mt-1 text-base text-[var(--p-ink-2)] tabular-nums">
                {filled} of {total} jobs filled
              </p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2 max-sm:hidden">
            <button type="button" className={cn(s.pill, s.pillSecondary)} onClick={() => void share()}>
              {copied ? 'Link copied' : 'Share'}
            </button>
            <button type="button" className={cn(s.pill, s.pillPrimary)} onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" />
              Add a skill
            </button>
          </div>
        </div>

        <Coverage
          className="mt-6"
          label={`${filled} of ${total} jobs filled`}
          groups={sections.map((sec) => ({
            id: sec.id,
            color: sec.color,
            cells: sec.slots.map((sl) => ({
              key: sl.job,
              filled: isFilled(sl),
              wave: fresh === `${sec.id}/${sl.job}` ? 0 : undefined,
            })),
          }))}
        />
        <p className="mt-4 text-sm text-pretty text-[var(--p-ink-2)]">
          Preview: your real skills on this Mac, sorted into jobs by me. Runs are from the last 30 days.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {sections.map((sec) => (
            <KitSection key={sec.id} sec={sec} fresh={fresh} onOpen={() => setOpenId(sec.id)} />
          ))}
        </div>
        <div className="mt-3 sm:mt-4">
          <KitSection sec={TAYLOR_TOOLS} fresh={fresh} onOpen={() => setOpenId(TAYLOR_TOOLS.id)} wide />
        </div>
      </main>

      <div className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-[auto_1fr] gap-2 border-t border-[var(--p-line)] bg-[var(--p-bg)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:hidden">
        <button type="button" className={cn(s.pill, s.pillSecondary, 'min-w-0')} onClick={() => void share()}>
          {copied ? 'Copied' : 'Share'}
        </button>
        <button type="button" className={cn(s.pill, s.pillPrimary, 'min-w-0')} onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" />
          Add a skill
        </button>
      </div>

      {openSec && (
        <SectionTray
          sec={openSec}
          open={openId !== null}
          onClose={() => setOpenId(null)}
          onPick={(job, skill) => updateSlot(openSec.id, job, (sl) => ({ ...sl, skills: [skill] }))}
          onCombine={(job) =>
            updateSlot(openSec.id, job, (sl) => ({
              ...sl,
              skills: [
                {
                  name: `Your ${sl.job.toLowerCase()}`,
                  by: `Combined from ${sl.skills.length}`,
                  avatarUrl: TAYLOR_AVATAR,
                  runs: sl.skills.reduce((n, k) => n + k.runs, 0),
                },
              ],
            }))
          }
          onTake={() => {
            for (const [job, skill] of Object.entries(TAKE_MARKETING)) {
              updateSlot('marketing', job, (sl) => (isFilled(sl) ? sl : { ...sl, skills: [skill] }))
            }
          }}
        />
      )}
      <AddTray
        open={adding}
        onClose={() => setAdding(false)}
        onAdd={(section, job, skill) => updateSlot(section, job, (sl) => ({ ...sl, skills: [...sl.skills, skill] }))}
        sectionName={(id) => all.find((sec) => sec.id === id)?.name ?? id}
      />
    </div>
  )
}

function KitSection({ sec, fresh, onOpen, wide }: { sec: MapSection; fresh: string | null; onOpen: () => void; wide?: boolean }) {
  const label = wide ? `${sec.slots.reduce((m, sl) => m + sl.skills.length, 0)} skills` : `${filledCount(sec)} of ${sec.slots.length}`
  return (
    <SectionCard sec={sec} label={label} onOpen={onOpen}>
      {sec.slots.map((sl) => {
        const lead = sl.skills[0]
        return (
          <JobChip
            key={`${sl.job}-${sl.skills.length}`}
            job={sl.job}
            filled={isFilled(sl)}
            avatar={lead ? { src: lead.avatarUrl, name: lead.by } : undefined}
            className={isFilled(sl) && fresh === `${sec.id}/${sl.job}` ? s.rise : undefined}
            extra={
              hasExtras(sl) ? (
                <span className="rounded-full bg-[var(--tile)] px-1.5 text-xs leading-5 font-bold text-[var(--tile-ink)]">
                  {sl.skills.length}
                </span>
              ) : sl.many ? (
                <span className="text-[var(--p-ink-2)] tabular-nums">{sl.skills.length}</span>
              ) : null
            }
          />
        )
      })}
    </SectionCard>
  )
}

function SectionTray({
  sec,
  open,
  onClose,
  onPick,
  onCombine,
  onTake,
}: {
  sec: MapSection
  open: boolean
  onClose: () => void
  onPick: (job: string, skill: MapSkill) => void
  onCombine: (job: string) => void
  onTake: () => void
}) {
  const empties = sec.slots.filter((sl) => !isFilled(sl)).length
  const canTake = sec.id === 'marketing' && sec.slots.some((sl) => !isFilled(sl) && TAKE_MARKETING[sl.job])
  return (
    <Tray open={open} onOpenChange={(o) => !o && onClose()} title={sec.name} style={secVars(sec)}>
      <p className="text-sm text-[var(--p-ink-2)]">
        {sec.id === 'tools'
          ? 'Things your AI can operate. Each holds as many as you like.'
          : empties === 0
            ? 'Every job here has a skill.'
            : `${empties} ${empties === 1 ? 'job has' : 'jobs have'} no skill yet.`}
      </p>
      <ul className="mt-2 divide-y divide-[var(--p-line)]">
        {sec.slots.map((sl) => {
          const pick = PICKS[sl.job]
          return (
            <li key={sl.job} className="flex items-start justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-base font-bold">{sl.job}</p>
                {isFilled(sl) ? (
                  <>
                    {sl.skills.slice(0, 4).map((k) => (
                      <SkillLine key={`${k.by}/${k.name}`} avatarUrl={k.avatarUrl} by={k.by} name={k.name} note={runsText(k.runs)} />
                    ))}
                    {sl.skills.length > 4 && (
                      <p className="mt-1 text-sm text-[var(--p-ink-2)]">and {sl.skills.length - 4} more</p>
                    )}
                  </>
                ) : pick ? (
                  <p className="mt-1 text-sm text-[var(--p-ink-2)]">
                    Empty. Top pick: {pick.name} by {pick.by}
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-[var(--p-ink-2)]">Empty</p>
                )}
              </div>
              {hasExtras(sl) ? (
                <button type="button" className={cn(s.pill, s.pillPrimary, 'h-10 min-w-0 shrink-0 px-4 text-sm')} onClick={() => onCombine(sl.job)}>
                  Combine
                </button>
              ) : !isFilled(sl) && pick ? (
                <button type="button" className={cn(s.pill, s.pillSecondary, 'h-10 min-w-0 shrink-0 px-4 text-sm')} onClick={() => onPick(sl.job, pick)}>
                  Add
                </button>
              ) : null}
            </li>
          )
        })}
      </ul>
      {canTake && (
        <button type="button" className={cn(s.pill, s.pillPrimary, 'mt-3 w-full')} onClick={onTake}>
          Take Corey Haines&apos; Marketing
        </button>
      )}
    </Tray>
  )
}

function AddTray({
  open,
  onClose,
  onAdd,
  sectionName,
}: {
  open: boolean
  onClose: () => void
  onAdd: (section: string, job: string, skill: MapSkill) => void
  sectionName: (id: string) => string
}) {
  const [link, setLink] = useState('')
  const [pending, setPending] = useState(false)
  const [placed, setPlaced] = useState<string | null>(null)
  const [error, setError] = useState('')

  const close = () => {
    onClose()
    window.setTimeout(() => {
      setPlaced(null)
      setLink('')
      setError('')
    }, 260)
  }

  /** Stub for the registry lookup: reads the link, then sorts it by its words. */
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    let parts: string[] = []
    try {
      const url = new URL(link.includes('://') ? link.trim() : `https://${link.trim()}`)
      parts = url.pathname.split('/').filter((p) => p && !/^(skill\.md|blob|tree|main|master|skills)$/i.test(p))
    } catch {
      parts = []
    }
    if (parts.length < 2) {
      setError('Paste a link to a skill on GitHub or Skillet.')
      return
    }
    setPending(true)
    setError('')
    await new Promise((r) => setTimeout(r, 650))
    const { section, job } = sortSkillLink(link)
    const name = humanizeSlug(parts[parts.length - 1])
    onAdd(section, job, { name, by: parts[0], avatarUrl: `https://github.com/${parts[0]}.png`, runs: 0 })
    setPlaced(`${sectionName(section)} · ${job}`)
    setPending(false)
  }

  return (
    <Tray open={open} onOpenChange={(o) => !o && close()} title={placed ? 'Added' : 'Add a skill'}>
      {placed ? (
        <div key="placed" className={cn(s.rise, 'flex items-center gap-3')}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--p-ink)] text-[var(--p-bg)]">
            <Check className="h-5 w-5" />
          </span>
          <p className="text-base">
            Sorted into <span className="font-bold">{placed}</span>.
          </p>
        </div>
      ) : (
        <form key="form" onSubmit={(e) => void submit(e)}>
          <p className="text-sm leading-[1.5] text-pretty text-[var(--p-ink-2)]">
            Paste any skill. It finds its job and slots in.
          </p>
          <label htmlFor="add-skill" className="mt-4 block text-sm font-medium">
            Link to the skill
          </label>
          <input
            id="add-skill"
            className={cn(s.input, 'mt-2')}
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="github.com/you/skills/cold-email"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'add-skill-error' : undefined}
          />
          {error && (
            <p id="add-skill-error" role="alert" className="mt-2 text-sm">
              {error}
            </p>
          )}
          <button type="submit" className={cn(s.pill, s.pillPrimary, 'mt-5 w-full')} disabled={pending || !link.trim()}>
            {pending ? 'Sorting…' : 'Add to my kit'}
          </button>
        </form>
      )}
    </Tray>
  )
}
