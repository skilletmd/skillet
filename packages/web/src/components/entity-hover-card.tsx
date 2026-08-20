'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const CARD_WIDTH = 340
const OPEN_DELAY = 280
const CLOSE_DELAY = 140

/**
 * A Twitter-style hover preview: an inline trigger (an xs pill) that, on hover,
 * floats a richer preview (`content` — typically the md card of the same entity)
 * anchored beneath it. Hover-intent delayed so a passing cursor doesn't trigger
 * it; a grace period + a bridge over the popover lets you move into it. Pointer
 * devices only — on touch the trigger just behaves as its underlying link.
 */
export function EntityHoverCard({ children, content }: { children: ReactNode; content: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const triggerRef = useRef<HTMLSpanElement | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(
    () => () => {
      clearTimeout(openTimer.current)
      clearTimeout(closeTimer.current)
    },
    [],
  )

  function show() {
    if (typeof window !== 'undefined' && !window.matchMedia('(hover: hover)').matches) return
    clearTimeout(closeTimer.current)
    openTimer.current = setTimeout(() => {
      const el = triggerRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const left = Math.max(12, Math.min(r.left, window.innerWidth - CARD_WIDTH - 12))
      setPos({ top: r.bottom + 8, left })
      setOpen(true)
    }, OPEN_DELAY)
  }

  function hide() {
    clearTimeout(openTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY)
  }

  return (
    <span ref={triggerRef} className="inline-flex" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {open &&
        pos &&
        createPortal(
          <div
            className="entity-hovercard"
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: CARD_WIDTH, zIndex: 60 }}
            onMouseEnter={() => clearTimeout(closeTimer.current)}
            onMouseLeave={hide}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  )
}
