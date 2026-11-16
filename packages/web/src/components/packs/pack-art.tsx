'use client'

import { forwardRef, useRef, type CSSProperties, type PointerEvent, type Ref } from 'react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/cn'
import type { Pack } from '@/lib/packs/types'
import s from './packs.module.css'

/** The pack's own colours, as the CSS variables its foil and cards read. */
export function packVars(pack: Pack): CSSProperties {
  return { '--pack': pack.color, '--pack-ink': pack.ink } as CSSProperties
}

/** Everyone whose skills are in the pack, once each. */
export function packMakers(pack: Pack) {
  const seen = new Map<string, Pack['slots'][number]['skill']>()
  for (const slot of pack.slots) if (!seen.has(slot.skill.makerHandle)) seen.set(slot.skill.makerHandle, slot.skill)
  return [...seen.values()]
}

/**
 * A sealed foil pack: crimped top and bottom, the jobs inside printed on the
 * front. A live pack catches the light and leans toward a fine pointer; the
 * values go straight to the element's style, never through React state.
 */
export const PackArt = forwardRef<
  HTMLDivElement,
  {
    pack: Pack
    /** Catches the light and leans toward the pointer. */
    live: boolean
    /** Not out yet: printed at half strength. */
    dim?: boolean
    /** Pixel width; left out, the wrapper's `--pack-w` decides. */
    width?: number
    /** Mid-tear: the top seal is a separate strip that flies off. */
    tearing?: boolean
    /** Opened: the top seal is gone. */
    torn?: boolean
    stripRef?: Ref<HTMLDivElement>
    className?: string
  }
>(function PackArt({ pack, live, dim, width, tearing, torn, stripRef, className }, outerRef) {
    const foil = useRef<HTMLDivElement>(null)
    const makers = packMakers(pack)

    const lean = (e: PointerEvent<HTMLDivElement>) => {
      const el = foil.current
      if (!live || !el || e.pointerType !== 'mouse') return
      const r = el.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width
      const y = (e.clientY - r.top) / r.height
      el.style.setProperty('--mx', `${x * 100}%`)
      el.style.setProperty('--my', `${y * 100}%`)
      el.style.setProperty('--ry', `${(x - 0.5) * 10}deg`)
      el.style.setProperty('--rx', `${(0.5 - y) * 8}deg`)
    }
    const settle = () => {
      const el = foil.current
      if (!el) return
      el.style.setProperty('--ry', '0deg')
      el.style.setProperty('--rx', '0deg')
    }

    return (
      <div
        ref={outerRef}
        className={cn(s.packWrap, className)}
        style={{ ...packVars(pack), ...(width ? { '--pack-w': `${width}px` } : {}) } as CSSProperties}
      >
        <div
          ref={foil}
          className={cn(s.pack, dim && s.packSoon)}
          data-live={live}
          data-torn={tearing || torn ? 'true' : undefined}
          onPointerMove={lean}
          onPointerLeave={settle}
        >
          <div className={s.seal} data-seal="top" />
          <div className="flex flex-1 flex-col px-5 pt-3.5 pb-4">
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="font-bold">Skillet</span>
              <span className="font-mono">No. {pack.number}</span>
            </div>
            <ul className="mt-4 flex flex-col gap-0.5 text-xl leading-[1.15] font-bold tracking-[-0.02em]">
              {pack.jobs.map((job) => (
                <li key={job}>{job}</li>
              ))}
            </ul>
            <div className="mt-auto">
              <p className="text-3xl leading-[1.05] font-bold tracking-[-0.04em]">{pack.name}</p>
              <p className="mt-2 flex min-h-6 items-center gap-2 text-sm font-medium">
                {makers.length > 0 ? (
                  <>
                    <span className="flex -space-x-1.5">
                      {makers.map((m) => (
                        <Avatar
                          key={m.makerHandle}
                          src={m.avatarUrl}
                          name={m.maker}
                          colorKey={m.makerHandle}
                          kind="person"
                          size="xs"
                          aria-hidden="true"
                          className="ring-2 ring-[var(--pack)]"
                        />
                      ))}
                    </span>
                    <span className="truncate">
                      {makers.length === 1 ? makers[0].maker : `${makers[0].maker} and ${makers.length - 1} more`}
                    </span>
                  </>
                ) : (
                  <span>Soon</span>
                )}
              </p>
            </div>
          </div>
          <div className={s.seal} />
          <div className={s.sheen} />
        </div>
        {tearing && <div ref={stripRef} className={s.strip} />}
      </div>
    )
  },
)
