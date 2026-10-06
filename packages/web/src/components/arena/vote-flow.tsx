'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { cn } from '@/lib/cn'
import type { ArenaPair, PairShot, Side } from '@/lib/arena/rounds'

type View = 'desktop' | 'phone'
type Choice = 'left' | 'right' | 'tie'

/**
 * The blind vote. One pair at a time: the brief, two unlabeled results, one
 * question. Sides are shuffled per voter and the versions' colors never appear
 * here, so nothing on screen says which side is which.
 *
 * Preview only: picks live in this component's state and go nowhere.
 */
export function VoteFlow({
  roundTitle,
  roundHref,
  closes,
  pairs,
}: {
  roundTitle: string
  roundHref: string
  closes: string
  pairs: ArenaPair[]
}) {
  const [index, setIndex] = useState(0)
  const [choices, setChoices] = useState<(Choice | null)[]>(() => pairs.map(() => null))
  const [view, setView] = useState<View>('desktop')
  const [zoom, setZoom] = useState<{ side: 'left' | 'right'; src: string } | null>(null)
  const [sealed, setSealed] = useState(false)
  const lastPress = useRef(0)

  // Phones start on the phone view: two desktop shots at half a phone's width
  // are too small to judge. Set after mount so the server render stays stable.
  useEffect(() => {
    if (window.matchMedia('(max-width: 639px)').matches) setView('phone')
  }, [])

  const pair = pairs[index]!
  const sides = useMemo(() => {
    const leftSide: Side = pair.left
    const rightSide: Side = leftSide === 'A' ? 'B' : 'A'
    return { left: pair.shots![leftSide], right: pair.shots![rightSide] }
  }, [pair])

  // Warm the next pair so the swap after a pick is instant.
  useEffect(() => {
    const next = pairs[index + 1]
    if (!next?.shots) return
    for (const shot of [next.shots.A, next.shots.B]) {
      for (const src of [shot.desktop, shot.phone]) {
        const img = new window.Image()
        img.src = src
      }
    }
  }, [index, pairs])

  const choose = useCallback(
    (choice: Choice) => {
      // A held key repeats; one pick per press.
      const now = Date.now()
      if (now - lastPress.current < 250) return
      lastPress.current = now
      setChoices((prev) => {
        const next = [...prev]
        next[index] = choice
        return next
      })
      if (index + 1 < pairs.length) setIndex(index + 1)
      else setSealed(true)
    },
    [index, pairs.length],
  )

  useEffect(() => {
    if (sealed || zoom) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (e.key === 'ArrowLeft') choose('left')
      else if (e.key === 'ArrowRight') choose('right')
      else if (e.key === 't' || e.key === 'T') choose('tie')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [choose, sealed, zoom])

  if (sealed) {
    return (
      <Sealed
        count={pairs.length}
        closes={closes}
        roundHref={roundHref}
        onReview={() => {
          setSealed(false)
          setIndex(0)
        }}
      />
    )
  }

  const picked = choices[index]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Link
          href={roundHref}
          className="text-sm text-(--ink-2) transition-colors hover:text-(--ink)"
        >
          ← {roundTitle}
        </Link>
        <Progress total={pairs.length} index={index} choices={choices} />
        <span className="ml-auto inline-flex items-center gap-2 rounded-full border border-(--line) bg-(--surface) px-3 py-1.5 text-xs text-(--ink-2)">
          <span className="size-2 rounded-full bg-(--success-line)" aria-hidden="true" />
          Voting as <span className="font-mono text-(--ink)">0x7a3f…91c4</span> · holder
        </span>
      </div>

      <div key={pair.n} className="arena-pair-in flex flex-col gap-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-[62ch]">
            <p className="text-xs font-semibold uppercase tracking-wider text-(--ink-2)">
              Brief · pair {index + 1} of {pairs.length}
            </p>
            <p className="mt-1.5 text-lg leading-snug text-(--ink)">{pair.brief}</p>
          </div>
          <SegmentedControl
            ariaLabel="Screen size"
            options={[
              { value: 'desktop', label: 'Desktop' },
              { value: 'phone', label: 'Phone' },
            ]}
            value={view}
            onChange={setView}
            className="shrink-0 self-start sm:self-auto"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-5">
          <Shot
            label="Left"
            shot={sides.left}
            view={view}
            onZoom={(src) => setZoom({ side: 'left', src })}
          />
          <Shot
            label="Right"
            shot={sides.right}
            view={view}
            onZoom={(src) => setZoom({ side: 'right', src })}
          />
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 border-t border-(--line) pt-6">
        <p className="text-center text-xl font-semibold tracking-tight text-(--ink)">
          Which would you ship for this brief?
        </p>
        <div className="grid w-full max-w-[520px] grid-cols-3 gap-2 sm:gap-3">
          <ChoiceButton
            label="Left"
            hint="←"
            active={picked === 'left'}
            onClick={() => choose('left')}
          />
          <ChoiceButton
            label="Tie"
            hint="T"
            active={picked === 'tie'}
            onClick={() => choose('tie')}
          />
          <ChoiceButton
            label="Right"
            hint="→"
            active={picked === 'right'}
            onClick={() => choose('right')}
          />
        </div>
        <div className="flex min-h-6 items-center gap-4 text-sm text-(--ink-2)">
          {index > 0 ? (
            <button
              type="button"
              onClick={() => setIndex(index - 1)}
              className="cursor-pointer rounded-md px-1 transition-colors hover:text-(--ink) focus-visible:outline-2 focus-visible:outline-(--accent)"
            >
              Previous pair
            </button>
          ) : (
            <span>Open any screenshot full size.</span>
          )}
        </div>
      </div>

      <Dialog open={zoom !== null} onOpenChange={(open) => !open && setZoom(null)}>
        <DialogContent className="max-h-[90vh] w-[min(94vw,1100px)] overflow-y-auto p-3">
          <DialogTitle className="px-1 pb-2 text-sm font-semibold text-(--ink)">
            {zoom?.side === 'left' ? 'Left' : 'Right'}, {view === 'desktop' ? 'desktop' : 'phone'}
          </DialogTitle>
          {zoom ? (
            <Image
              src={zoom.src}
              alt={`${zoom.side === 'left' ? 'Left' : 'Right'} result, full size`}
              width={view === 'desktop' ? 1440 : 780}
              height={view === 'desktop' ? 900 : 1688}
              className={cn(
                'h-auto rounded-lg border border-(--line)',
                view === 'phone' ? 'mx-auto w-full max-w-[390px]' : 'w-full',
              )}
              unoptimized
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function Progress({
  total,
  index,
  choices,
}: {
  total: number
  index: number
  choices: (Choice | null)[]
}) {
  return (
    <ol className="flex items-center gap-1" aria-label={`Pair ${index + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <li
          key={i}
          aria-hidden="true"
          className={cn(
            'h-1.5 w-5 rounded-full transition-colors duration-300 ease-[var(--ease)] sm:w-7',
            i === index ? 'bg-(--ink)' : choices[i] ? 'bg-(--ink-2)' : 'bg-(--line)',
          )}
        />
      ))}
    </ol>
  )
}

function Shot({
  label,
  shot,
  view,
  onZoom,
}: {
  label: string
  shot: PairShot
  view: View
  onZoom: (src: string) => void
}) {
  const src = view === 'desktop' ? shot.desktop : shot.phone
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="font-mono text-xs uppercase tracking-[0.08em] text-(--ink-2)">
        {label}
      </figcaption>
      <button
        type="button"
        onClick={() => onZoom(src)}
        aria-label={`See ${label.toLowerCase()} full size`}
        className={cn(
          'group block cursor-zoom-in overflow-hidden rounded-xl border border-(--line) bg-(--surface) shadow-(--shadow-sm) transition-[border-color,transform] duration-200 ease-[var(--ease)] hover:border-[color-mix(in_srgb,var(--line)_50%,var(--ink-2))] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--accent)',
          view === 'phone' && 'mx-auto w-full max-w-[300px]',
        )}
      >
        <Image
          src={src}
          alt={`${label} result at ${view} width`}
          width={view === 'desktop' ? 1440 : 780}
          height={view === 'desktop' ? 900 : 1688}
          sizes={
            view === 'desktop' ? '(max-width: 640px) 50vw, 540px' : '(max-width: 640px) 50vw, 300px'
          }
          className="h-auto w-full"
          priority
          unoptimized
        />
      </button>
    </figure>
  )
}

function ChoiceButton({
  label,
  hint,
  active,
  onClick,
}: {
  label: string
  hint: string
  active: boolean
  onClick: () => void
}) {
  return (
    <Button
      variant={active ? 'primary' : 'secondary'}
      size="lg"
      onClick={onClick}
      aria-pressed={active}
      className="w-full min-w-0"
    >
      {label}
      <kbd className="max-sm:hidden rounded border border-current/20 px-1.5 py-0.5 font-mono text-2xs font-normal opacity-60">
        {hint}
      </kbd>
    </Button>
  )
}

function Sealed({
  count,
  closes,
  roundHref,
  onReview,
}: {
  count: number
  closes: string
  roundHref: string
  onReview: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-6 py-10 text-center sm:py-16">
      <div className="arena-seal grid size-36 place-items-center rounded-full border-2 border-dashed border-(--ink) p-2">
        <div className="grid size-full place-items-center rounded-full border border-(--ink) text-(--ink)">
          <span className="flex flex-col items-center leading-none">
            <span className="font-mono text-3xl font-semibold tabular-nums">{count}</span>
            <span className="mt-1.5 font-mono text-2xs uppercase tracking-[0.2em]">Sealed</span>
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight text-(--ink)">
          Your {count} picks are sealed.
        </h2>
        <p className="mx-auto max-w-[46ch] text-(--ink-2)">
          They're signed with your wallet and open when the round closes on {closes}. Nobody sees a
          vote before then, including the authors.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button href={roundHref}>Back to the round</Button>
        <Button variant="secondary" onClick={onReview}>
          Change a pick
        </Button>
      </div>
    </div>
  )
}
