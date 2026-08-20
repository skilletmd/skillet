'use client'

import Link from 'next/link'
import { Fragment, type ReactNode, useEffect, useState } from 'react'
import { compactCount } from '@/lib/format-count'
import { SKILLET_EVENTS } from '@/lib/events'

/**
 * One "used by" concept across Skillet — adding a skill to a kit and subscribing
 * to a kit are the same act (you now use it), so they share one count and one
 * event. Controls fire `skillet:used` with `{ id, delta }` (id = a kit id or a
 * skill ref); these components hold the count and react optimistically, so the
 * number bumps the instant you click Add, no round-trip.
 */

/** Subscribe to the live "used by" count for one object (kit id or skill ref). */
function useLiveCount(id: string, initial: number): number {
  const [count, setCount] = useState(initial)
  useEffect(() => {
    function onUsed(event: Event) {
      const detail = (event as CustomEvent<{ id: string; delta: number }>).detail
      if (detail?.id === id) setCount((c) => Math.max(0, c + detail.delta))
    }
    window.addEventListener(SKILLET_EVENTS.used, onUsed as EventListener)
    return () => window.removeEventListener(SKILLET_EVENTS.used, onUsed as EventListener)
  }, [id])
  return count
}

/** Emit a used-by delta — call from an Add/Subscribe control. */
export function emitUsed(id: string, delta: number) {
  window.dispatchEvent(new CustomEvent(SKILLET_EVENTS.used, { detail: { id, delta } }))
}

/** The compact "· N subs" tail on a kit's lg tile subtitle. */
export function KitSubCount({
  id,
  initial,
  lead = true,
}: {
  id: string
  initial: number
  /** Prefix with " · " (true) when it follows other meta; false when it's the
   *  only item on the line. */
  lead?: boolean
}) {
  const count = useLiveCount(id, initial)
  if (count <= 0) return null
  return (
    <>
      {lead ? ' · ' : ''}
      Used by <span className="tabular-nums">{compactCount(count)}</span>
    </>
  )
}

/**
 * The "Used by @x, @y and N others" social-proof line on an md card — skills and
 * kits alike. Named faces stay server-rendered; only the count reacts, so Add
 * bumps "and N others" instantly.
 */
export function UsedByProof({
  id,
  initial,
  faces,
  variant = 'inline',
}: {
  id: string
  initial: number
  faces: Array<{ handle: string }>
  /** `inline` = the one-line card footer (truncates, leads with "Used by").
   *  `block` = the sidebar line under a heading (wraps, no "Used by" prefix). */
  variant?: 'inline' | 'block'
}) {
  const count = useLiveCount(id, initial)
  const named = faces.slice(0, 2)
  const rest = Math.max(0, count - named.length)
  const flow = variant === 'block' ? 'whitespace-normal' : 'min-w-0 truncate'

  if (count === 0) return <span className={`${flow} opacity-80`}>New</span>
  if (named.length === 0) {
    return (
      <span className={`${flow} tabular-nums opacity-80`}>
        {variant === 'block'
          ? `${compactCount(count)} ${count === 1 ? 'person' : 'people'}`
          : `Used by ${compactCount(count)}`}
      </span>
    )
  }

  const handle = (h: string) => (
    <Link
      key={h}
      href={`/${h}`}
      className="relative z-[1] font-medium hover:text-(--ink) hover:underline"
    >
      @{h}
    </Link>
  )

  // Join the named handle links with text separators: "@x, @y" or "@x and @y".
  const links: ReactNode[] = []
  named.forEach((f, i) => {
    if (i > 0) links.push(rest > 0 ? ', ' : ' and ')
    links.push(handle(f.handle))
  })

  return (
    <span className={`${flow} tabular-nums opacity-80`}>
      {variant === 'inline' && 'Used by '}
      {links.map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
      {rest > 0 && ` and ${compactCount(rest)} others`}
    </span>
  )
}
