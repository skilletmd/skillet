'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Clamp long rendered content (e.g. a SKILL.md body) to a max height with a fade
 * and a "show full" toggle, so a sprawling doc doesn't dominate the page. The
 * toggle only appears when the content actually overflows.
 */
export function CollapsibleDocument({
  children,
  maxHeight = 640,
}: {
  children: ReactNode
  maxHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setOverflows(el.scrollHeight > maxHeight + 48)
    measure()
    // ResizeObserver is absent in jsdom / very old browsers — measure once there.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [maxHeight])

  return (
    <div>
      <div
        ref={ref}
        className="relative overflow-hidden"
        style={{ maxHeight: expanded ? undefined : maxHeight }}
      >
        {children}
        {overflows && !expanded && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-(--surface) to-transparent" />
        )}
      </div>
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 text-sm font-medium text-(--ink-2) underline-offset-2 hover:text-(--ink) hover:underline"
        >
          {expanded ? 'Show less' : 'Show full SKILL.md'}
        </button>
      )}
    </div>
  )
}
