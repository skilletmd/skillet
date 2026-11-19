'use client'

import Link from 'next/link'
import { useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent, type JSX, type RefObject } from 'react'
import { ClaudeLogo, CodexLogo, CursorLogo, OpenAiLogo } from '@/components/brand-logos'
import { ThemeToggle } from '@/components/theme-toggle'
import { Avatar } from '@/components/ui/avatar'
import { ArrowLeft, Check } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { humanizeSlug } from '@/lib/humanize-slug'
import { PACKS, SAMPLE_BRAND } from '@/lib/packs/data'
import type { Pack } from '@/lib/packs/types'
import { PackArt, packMakers, packVars } from './pack-art'
import { OwnSlotCard, SampleView, SlotCard } from './slot-card'
import { Tray } from './tray'
import s from './packs.module.css'

type Phase = 'shelf' | 'tearing' | 'dealing' | 'open'
type TargetId = 'claude' | 'chatgpt' | 'codex' | 'cursor'
type TrayState = { kind: 'slot'; index: number } | { kind: 'add' } | { kind: 'own' }

const TARGETS: { id: TargetId; name: string; Logo: (p: { className?: string }) => JSX.Element }[] = [
  { id: 'claude', name: 'Claude', Logo: ClaudeLogo },
  { id: 'chatgpt', name: 'ChatGPT', Logo: OpenAiLogo },
  { id: 'codex', name: 'Codex', Logo: CodexLogo },
  { id: 'cursor', name: 'Cursor', Logo: CursorLogo },
]

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)'
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Stub for the install, kept to this one function so wiring it to the Skillet
 * connector is one change. It behaves as the real call will: a short wait,
 * then done, an error when offline, and a 10 second limit.
 */
async function addPackTo(_pack: Pack, _target: TargetId): Promise<void> {
  const attempt = wait(900).then(() => {
    if (!navigator.onLine) throw new Error('offline')
  })
  const limit = wait(10_000).then(() => {
    throw new Error('timeout')
  })
  await Promise.race([attempt, limit])
}

/** Stub for the registry lookup a pasted skill link will get. */
async function lookUpSkill(link: string): Promise<{ name: string; maker: string }> {
  await wait(700)
  const found = readSkillLink(link)
  if (!found) throw new Error('unreadable')
  return found
}

function readSkillLink(link: string): { name: string; maker: string } | null {
  const raw = link.trim()
  if (!raw) return null
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`)
    if (!/(^|\.)(github\.com|skillet\.md)$/.test(url.hostname)) return null
    const parts = url.pathname
      .split('/')
      .filter(Boolean)
      .filter((part) => !/^(skill\.md|blob|tree|main|master)$/i.test(part))
    if (parts.length < 2) return null
    return { maker: parts[0], name: humanizeSlug(parts[parts.length - 1]) }
  } catch {
    return null
  }
}

export function PacksApp({ initialOpen }: { initialOpen: string | null }) {
  const initial = PACKS.find((p) => p.id === initialOpen && p.slots.length > 0) ?? null
  const [pack, setPack] = useState<Pack | null>(initial)
  const [phase, setPhase] = useState<Phase>(initial ? 'open' : 'shelf')
  const [tearingId, setTearingId] = useState<string | null>(null)
  const [ghost, setGhost] = useState<DOMRect | null>(null)
  const [tray, setTray] = useState<TrayState | null>(null)
  const [own, setOwn] = useState<{ name: string; maker: string } | null>(null)

  const packEls = useRef(new Map<string, HTMLDivElement>())
  const stripEl = useRef<HTMLDivElement>(null)
  const ghostEl = useRef<HTMLDivElement>(null)
  const fromRect = useRef<DOMRect | null>(null)
  const cardEls = useRef<(HTMLDivElement | null)[]>([])

  const show = (next: Pack) => {
    setPack(next)
    setPhase('open')
    window.history.replaceState(null, '', `/packs?open=${next.id}`)
  }

  /** The one signature beat: the seal tears, the pack sinks, the cards deal out and flip. */
  const openPack = async (next: Pack) => {
    if (phase !== 'shelf') return
    const el = packEls.current.get(next.id)
    if (!el || reducedMotion()) {
      show(next)
      return
    }
    setTearingId(next.id)
    setPhase('tearing')
    await new Promise((resolve) => requestAnimationFrame(resolve))
    stripEl.current?.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: 'translate(20px, -40px) rotate(-9deg)', opacity: 0 },
      ],
      { duration: 360, easing: EASE_OUT, fill: 'forwards' },
    )
    el.animate([{ transform: 'none' }, { transform: 'translateY(3px) scale(0.985)' }, { transform: 'none' }], {
      duration: 280,
      easing: EASE_OUT,
    })
    await wait(230)
    fromRect.current = el.getBoundingClientRect()
    setGhost(fromRect.current)
    setPack(next)
    setPhase('dealing')
    window.history.replaceState(null, '', `/packs?open=${next.id}`)
  }

  // Deal: every card flies out of where the pack was, face down, then flips.
  // Any key or tap finishes it at once.
  useLayoutEffect(() => {
    if (phase !== 'dealing') return
    const from = fromRect.current
    const all = cardEls.current.filter((c): c is HTMLDivElement => c !== null)
    // Your slot was never in the pack: it waits in the lineup and fades up.
    const cards = all.filter((c) => !('own' in c.dataset))
    const ownCard = all.find((c) => 'own' in c.dataset)
    if (!from || cards.length === 0) {
      setPhase('open')
      return
    }
    window.scrollTo({ top: 0 })
    const anims: Animation[] = []
    const mid = (cards.length - 1) / 2
    cards.forEach((card, i) => {
      const r = card.getBoundingClientRect()
      const dx = from.left + from.width / 2 - (r.left + r.width / 2)
      const dy = from.top + from.height / 2 - (r.top + r.height / 2)
      const scale = Math.min(1, (from.width / r.width) * 0.8)
      anims.push(
        card.animate(
          [
            { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(${(i - mid) * 5}deg)`, opacity: 0 },
            { opacity: 1, offset: 0.1 },
            { transform: 'none', opacity: 1 },
          ],
          { duration: 560, delay: 120 + i * 60, easing: EASE_OUT, fill: 'backwards' },
        ),
      )
      const inner = card.querySelector<HTMLElement>('[data-inner]')
      if (inner && card.dataset.face === 'front') {
        anims.push(
          inner.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)' }], {
            duration: 400,
            delay: 520 + i * 80,
            easing: EASE_OUT,
            fill: 'backwards',
          }),
        )
      }
    })
    if (ownCard) {
      anims.push(
        ownCard.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: 300,
          delay: 520 + cards.length * 80,
          easing: EASE_OUT,
          fill: 'backwards',
        }),
      )
    }
    const g = ghostEl.current
    if (g) {
      anims.push(
        g.animate(
          [
            { transform: 'none', opacity: 1 },
            { transform: 'translateY(36px) scale(0.92)', opacity: 0 },
          ],
          { duration: 420, delay: 60, easing: EASE_OUT, fill: 'forwards' },
        ),
      )
    }
    const finish = () => anims.forEach((a) => a.finish())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') finish()
    }
    window.addEventListener('pointerdown', finish)
    window.addEventListener('keydown', onKey)
    let live = true
    Promise.all(anims.map((a) => a.finished))
      .catch(() => undefined)
      .then(() => {
        if (!live) return
        setGhost(null)
        setTearingId(null)
        setPhase('open')
      })
    return () => {
      live = false
      window.removeEventListener('pointerdown', finish)
      window.removeEventListener('keydown', onKey)
    }
  }, [phase])

  const backToShelf = () => {
    setTray(null)
    setPack(null)
    setPhase('shelf')
    window.history.replaceState(null, '', '/packs')
    window.scrollTo({ top: 0 })
  }

  const opened = (phase === 'dealing' || phase === 'open') && pack !== null

  return (
    <div className={cn(s.tokens, s.page)}>
      <header className="mx-auto flex max-w-[1120px] items-center justify-between px-4 py-3 sm:px-8">
        <Link href="/" className="site-brand-link flex items-center font-mono text-base font-bold">
          <span className="site-logo-mark" aria-hidden="true" />
          Skillet
        </Link>
        <ThemeToggle />
      </header>

      {opened ? (
        <Opened
          pack={pack}
          dealing={phase === 'dealing'}
          own={own}
          cardEls={cardEls}
          onBack={backToShelf}
          onOpenSlot={(index) => setTray({ kind: 'slot', index })}
          onAdd={() => setTray({ kind: 'add' })}
          onOwn={() => setTray({ kind: 'own' })}
        />
      ) : (
        <main className="mx-auto max-w-[1120px] px-4 pt-6 pb-16 sm:px-8 sm:pt-12">
          <h1 className={cn(s.rise, 'text-5xl leading-[1.05] font-bold tracking-[-0.045em] text-balance max-sm:text-4xl')}>
            Teach your AI a job
          </h1>
          <p
            className={cn(s.rise, 'mt-3 max-w-[46ch] text-base leading-[1.5] text-pretty text-[var(--p-ink-2)]')}
            style={{ '--d': '90ms' } as CSSProperties}
          >
            Each pack is a set of skills for one kind of work. Open one to see what every skill writes, then add the
            pack to Claude in one tap.
          </p>
          <ul
            className={cn(
              s.rise,
              '-mx-4 mt-10 flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 pt-2 pb-8 [--pack-w:256px] sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-7 sm:overflow-visible sm:px-0 sm:[--pack-w:100%]',
            )}
            style={{ '--d': '180ms' } as CSSProperties}
          >
            {PACKS.map((p) => {
              const live = p.slots.length > 0
              const away = phase === 'tearing' && p.id !== tearingId
              return (
                <li
                  key={p.id}
                  className="flex shrink-0 snap-start flex-col items-center gap-5 transition-[opacity,transform] duration-200 ease-out"
                  style={away ? { opacity: 0, transform: 'translateY(8px)' } : undefined}
                >
                  <PackArt
                    ref={(el) => {
                      if (el) packEls.current.set(p.id, el)
                    }}
                    pack={p}
                    live={live}
                    tearing={tearingId === p.id}
                    stripRef={tearingId === p.id ? stripEl : undefined}
                  />
                  {live ? (
                    <button
                      type="button"
                      className={cn(s.pill, s.pillPrimary)}
                      onClick={() => void openPack(p)}
                      disabled={phase !== 'shelf'}
                    >
                      Open pack
                    </button>
                  ) : null}
                </li>
              )
            })}
          </ul>
          <p className="text-sm text-[var(--p-ink-2)]">Preview: real skills and real samples. Adding installs nothing yet.</p>
        </main>
      )}

      {ghost && pack && (
        <div
          ref={ghostEl}
          aria-hidden="true"
          className="pointer-events-none fixed z-30"
          style={{ left: ghost.left, top: ghost.top, width: ghost.width }}
        >
          <PackArt pack={pack} live={false} width={ghost.width} torn />
        </div>
      )}

      {pack && (
        <>
          <SlotTray pack={pack} tray={tray} onClose={() => setTray(null)} />
          <AddTray pack={pack} open={tray?.kind === 'add'} onClose={() => setTray(null)} />
          <OwnTray
            pack={pack}
            open={tray?.kind === 'own'}
            onClose={() => setTray(null)}
            onAdded={(found) => {
              setOwn(found)
              setTray(null)
            }}
          />
        </>
      )}
    </div>
  )
}

function MiniPack({ pack }: { pack: Pack }) {
  return (
    <div
      className={s.packWrap}
      style={
        {
          ...packVars(pack),
          '--pack-w': '44px',
          filter: 'drop-shadow(0 3px 4px rgb(var(--p-shade) / 0.16))',
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <div className={s.pack} style={{ '--t': '3px', '--w': '6px' } as CSSProperties}>
        <div className={s.seal} style={{ height: 9 }} />
        <div className="flex-1" />
        <div className={s.seal} style={{ height: 9 }} />
      </div>
    </div>
  )
}

function Opened({
  pack,
  dealing,
  own,
  cardEls,
  onBack,
  onOpenSlot,
  onAdd,
  onOwn,
}: {
  pack: Pack
  dealing: boolean
  own: { name: string; maker: string } | null
  cardEls: RefObject<(HTMLDivElement | null)[]>
  onBack: () => void
  onOpenSlot: (index: number) => void
  onAdd: () => void
  onOwn: () => void
}) {
  const makers = packMakers(pack)
  const total = pack.slots.length
  return (
    <>
      <main className="mx-auto max-w-[1040px] px-4 pb-32 sm:px-8 sm:pb-20" style={packVars(pack)}>
        <button
          type="button"
          onClick={onBack}
          className="-ml-1 flex h-11 items-center gap-1.5 rounded-full px-1 text-sm font-medium text-[var(--p-ink-2)] transition-colors hover:text-[var(--p-ink)] focus-visible:outline-2 focus-visible:outline-[var(--p-ink)]"
        >
          <ArrowLeft className="h-4 w-4" />
          Packs
        </button>
        <div className="mt-2 flex items-end justify-between gap-6">
          <div className="flex min-w-0 items-center gap-4">
            <MiniPack pack={pack} />
            <div className="min-w-0">
              <h1 className="text-3xl leading-[1.05] font-bold tracking-[-0.04em]">{pack.name}</h1>
              <p className="mt-1.5 flex items-center gap-2 text-sm text-[var(--p-ink-2)]">
                {makers[0] && (
                  <Avatar
                    src={makers[0].avatarUrl}
                    name={makers[0].maker}
                    colorKey={makers[0].makerHandle}
                    kind="person"
                    size="xxs"
                    aria-hidden="true"
                  />
                )}
                <span className="truncate">
                  {total} skills by {makers.map((m) => m.maker).join(', ')}
                </span>
              </p>
            </div>
          </div>
          <button type="button" className={cn(s.pill, s.pillPrimary, 'max-sm:hidden')} onClick={onAdd}>
            Add pack
          </button>
        </div>
        <p className="mt-7 text-sm text-pretty text-[var(--p-ink-2)]">
          Every sample answers the same brief: {SAMPLE_BRAND.brief}.
        </p>
        <div className="-mx-4 mt-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pt-1 pb-6 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-5 sm:overflow-visible sm:px-0 sm:pt-0">
          {pack.slots.map((slot, i) => (
            <SlotCard
              key={slot.job}
              ref={(el) => {
                cardEls.current[i] = el
              }}
              slot={slot}
              index={i}
              total={total}
              face="front"
              disabled={dealing}
              onOpen={() => onOpenSlot(i)}
            />
          ))}
          <OwnSlotCard
            ref={(el) => {
              cardEls.current[total] = el
            }}
            added={own}
            disabled={dealing}
            onOpen={onOwn}
          />
        </div>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--p-line)] bg-[var(--p-bg)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:hidden">
        <button type="button" className={cn(s.pill, s.pillPrimary, 'w-full')} onClick={onAdd}>
          Add pack
        </button>
      </div>
    </>
  )
}

function SlotTray({ pack, tray, onClose }: { pack: Pack; tray: TrayState | null; onClose: () => void }) {
  // Keep the last slot while the tray animates shut.
  const last = useRef<number>(0)
  if (tray?.kind === 'slot') last.current = tray.index
  const slot = pack.slots[last.current]
  if (!slot) return null
  return (
    <Tray
      open={tray?.kind === 'slot'}
      onOpenChange={(o) => !o && onClose()}
      title={slot.job}
      style={packVars(pack)}
    >
      <div className={cn(s.art, 'mx-0')}>
        <SampleView sample={slot.sample} full />
      </div>
      <p className="mt-2.5 text-xs text-[var(--p-ink-2)]">Written for the sample brief: {SAMPLE_BRAND.brief}.</p>
      <div className="mt-5 flex items-start gap-3">
        <Avatar
          src={slot.skill.avatarUrl}
          name={slot.skill.maker}
          colorKey={slot.skill.makerHandle}
          kind="person"
          size="sm"
          aria-hidden="true"
        />
        <div className="min-w-0">
          <p className="text-base font-bold">
            {slot.skill.name} <span className="font-normal text-[var(--p-ink-2)]">by {slot.skill.maker}</span>
          </p>
          <p className="mt-1 text-sm leading-[1.5] text-pretty text-[var(--p-ink-2)]">{slot.skill.description}</p>
          <a
            href={slot.skill.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-sm font-medium underline underline-offset-2"
          >
            Source on GitHub
          </a>
        </div>
      </div>
    </Tray>
  )
}

function AddTray({ pack, open, onClose }: { pack: Pack; open: boolean; onClose: () => void }) {
  const [target, setTarget] = useState<TargetId>('claude')
  const [status, setStatus] = useState<'choose' | 'pending' | 'done' | 'error'>('choose')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const name = TARGETS.find((t) => t.id === target)!.name
  const count = pack.slots.length

  const add = async () => {
    setStatus('pending')
    setError('')
    try {
      await addPackTo(pack, target)
      setStatus('done')
    } catch (e) {
      setError(
        e instanceof Error && e.message === 'offline'
          ? "You're offline. Try again once you're back."
          : `${name} didn't answer. Try again.`,
      )
      setStatus('error')
    }
  }
  const close = () => {
    onClose()
    // Reset once the tray has slid away, so it reopens on the first step.
    window.setTimeout(() => {
      setStatus('choose')
      setCopied(false)
    }, 260)
  }
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/packs?open=${pack.id}`)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Tray
      open={open}
      onOpenChange={(o) => !o && close()}
      title={status === 'done' ? `${pack.name} is in ${name}` : `Add ${pack.name} to`}
      style={packVars(pack)}
    >
      {status === 'done' ? (
        <div key="done" className={cn(s.rise, 'flex flex-col items-center pt-2 text-center')}>
          <span className={s.done}>
            <Check className="h-6 w-6" />
          </span>
          <p className="mt-4 max-w-[32ch] text-sm leading-[1.5] text-pretty text-[var(--p-ink-2)]">
            Ask {name} for a launch post, and {pack.slots[0]?.skill.name} writes it the way the card showed.
          </p>
          <div className="mt-6 grid w-full grid-cols-2 gap-2">
            <button type="button" className={cn(s.pill, s.pillSecondary, 'min-w-0')} onClick={() => void copyLink()}>
              {copied ? 'Link copied' : 'Copy link'}
            </button>
            <button type="button" className={cn(s.pill, s.pillPrimary, 'min-w-0')} onClick={close}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div key="choose">
          <div role="radiogroup" aria-label="Where to add it" className="flex flex-col gap-2">
            {TARGETS.map(({ id, name: label, Logo }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={target === id}
                className={s.option}
                onClick={() => setTarget(id)}
                disabled={status === 'pending'}
              >
                <Logo className="h-6 w-6" />
                {label}
                <span className={s.radio} aria-hidden="true" />
              </button>
            ))}
          </div>
          <button
            type="button"
            className={cn(s.pill, s.pillPrimary, 'mt-5 w-full')}
            onClick={() => void add()}
            disabled={status === 'pending'}
          >
            {status === 'pending' ? 'Adding…' : `Add ${count} skills to ${name}`}
          </button>
          {status === 'error' ? (
            <p role="alert" className="mt-3 text-center text-sm text-[var(--p-ink)]">
              {error}
            </p>
          ) : (
            <p className="mt-3 text-center text-sm text-[var(--p-ink-2)]">Preview. Nothing installs yet.</p>
          )}
        </div>
      )}
    </Tray>
  )
}

function OwnTray({
  pack,
  open,
  onClose,
  onAdded,
}: {
  pack: Pack
  open: boolean
  onClose: () => void
  onAdded: (found: { name: string; maker: string }) => void
}) {
  const [link, setLink] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError('')
    try {
      onAdded(await lookUpSkill(link))
      setLink('')
    } catch {
      setError('Paste a link to a skill on GitHub or Skillet.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Tray open={open} onOpenChange={(o) => !o && onClose()} title="Your slot" style={packVars(pack)}>
      <form onSubmit={(e) => void submit(e)}>
        <p className="text-sm leading-[1.5] text-pretty text-[var(--p-ink-2)]">
          Add a skill you already use. It joins {pack.name} and goes wherever the pack goes.
        </p>
        <label htmlFor="own-skill" className="mt-5 block text-sm font-medium">
          Link to the skill
        </label>
        <input
          id="own-skill"
          className={cn(s.input, 'mt-2')}
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="github.com/you/skills/your-skill"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'own-skill-error' : undefined}
        />
        {error && (
          <p id="own-skill-error" role="alert" className="mt-2 text-sm text-[var(--p-ink)]">
            {error}
          </p>
        )}
        <button
          type="submit"
          className={cn(s.pill, s.pillPrimary, 'mt-5 w-full')}
          disabled={pending || link.trim() === ''}
        >
          {pending ? 'Adding…' : 'Add to pack'}
        </button>
      </form>
    </Tray>
  )
}
