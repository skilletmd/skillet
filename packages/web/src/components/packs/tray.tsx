'use client'

import * as RadixDialog from '@radix-ui/react-dialog'
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { Close } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import s from './packs.module.css'

/**
 * A Family-style tray: a sheet that floats off the bottom edge on a phone and
 * sits centred on a desktop. Its body tracks the height of what's inside, so a
 * tray grows into its next step instead of swapping panels.
 */
export function Tray({
  open,
  onOpenChange,
  title,
  style,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  style?: CSSProperties
  children: ReactNode
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={s.overlay} />
        <RadixDialog.Content className={cn(s.tokens, s.tray)} style={style} aria-describedby={undefined}>
          <div className="flex items-start justify-between gap-3">
            <RadixDialog.Title className="pt-1.5 text-xl leading-[1.2] font-bold tracking-[-0.02em] text-balance">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close className={s.closeButton} aria-label="Close">
              <Close className="h-4 w-4" />
            </RadixDialog.Close>
          </div>
          <Grow>{children}</Grow>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/** Animates its own height to whatever its content measures. */
function Grow({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const o = outer.current
    const i = inner.current
    if (!o || !i) return
    o.style.height = `${i.offsetHeight}px`
    const ro = new ResizeObserver(() => {
      o.style.height = `${i.offsetHeight}px`
    })
    ro.observe(i)
    return () => ro.disconnect()
  }, [])
  return (
    <div ref={outer} className={s.trayBody}>
      <div ref={inner} className="pt-4">
        {children}
      </div>
    </div>
  )
}
