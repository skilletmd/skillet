'use client'

import type { ReactNode } from 'react'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Close } from '@/components/ui/icons'

/**
 * A stat card that opens its own full chart. The card and the chart are both
 * server-rendered and passed in as slots, so this client component carries only
 * the open/close state, not the data or the SVG.
 */
export function StatDialog({
  title,
  card,
  chart,
}: {
  /** Accessible name for the dialog, e.g. the metric label. */
  title: string
  card: ReactNode
  chart: ReactNode
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`${title}: see the full chart`}
          className="block h-full w-full cursor-pointer text-left outline-none focus-visible:rounded-2xl focus-visible:ring-2 focus-visible:ring-(--accent)"
        >
          {card}
        </button>
      </DialogTrigger>
      <DialogContent className="w-[min(94vw,820px)] p-6 sm:p-8">
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogClose
          aria-label="Close"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-(--ink-2) transition-colors hover:bg-(--card-soft) hover:text-(--ink)"
        >
          <Close className="h-4 w-4" />
        </DialogClose>
        {chart}
      </DialogContent>
    </Dialog>
  )
}
