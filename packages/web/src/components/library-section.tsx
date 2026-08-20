'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/ui/panel'
import { SECTION_TITLE_CLASS } from '@/lib/page-layout'

/**
 * One Library section (Kits, Skills) with a consistent header: title + count on
 * the left, a single create action on the right. The create action is either a
 * link (skills → the full editor) or an inline disclosure (kits → a form that
 * expands under the header). Same placement + style for every section so the IA
 * reads as one surface, not scattered buttons.
 */
export function LibrarySection({
  id,
  title,
  count,
  level = 'section',
  createLabel,
  createHref,
  createForm,
  secondaryHref,
  secondaryLabel,
  children,
}: {
  id: string
  title: string
  count?: number
  /** 'page' = top-of-page title (26px); 'section' = sub-section heading (19px);
   *  'eyebrow' = the detail pages' quiet uppercase label (profile sections),
   *  with the create action as an accent text link instead of a button. */
  level?: 'page' | 'section' | 'eyebrow'
  createLabel: string
  /** Link target for create (e.g. skills → /studio/new). */
  createHref?: string
  /** Inline form revealed under the header (e.g. kits → KitCreateForm). */
  createForm?: React.ReactNode
  /** Optional quieter action shown before the primary one. */
  secondaryHref?: string
  secondaryLabel?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const isEyebrow = level === 'eyebrow'

  return (
    <section id={id} className="scroll-mt-24">
      <div
        className={
          isEyebrow
            ? 'flex items-baseline justify-between gap-4'
            : 'flex min-h-[38px] items-center justify-between gap-4'
        }
      >
        <h2
          className={
            level === 'page'
              ? 'text-2xl font-semibold tracking-tight text-(--ink)'
              : isEyebrow
                ? 'text-xs font-semibold uppercase tracking-wider text-(--ink-2)'
                : SECTION_TITLE_CLASS
          }
        >
          {title}
          {count !== undefined && (
            <span
              className={`ml-2 font-normal tabular-nums text-(--ink-2) ${
                level === 'page' ? 'text-lg' : isEyebrow ? 'text-xs' : 'text-sm'
              }`}
            >
              {count}
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2">
          {secondaryHref && secondaryLabel && (
            <Button href={secondaryHref} variant="secondary">
              {secondaryLabel}
            </Button>
          )}
          {createHref ? (
            isEyebrow ? (
              <Link
                href={createHref}
                className="text-sm font-medium text-(--accent) hover:underline"
              >
                + {createLabel}
              </Link>
            ) : (
              <Button href={createHref} variant="secondary">
                + {createLabel}
              </Button>
            )
          ) : createForm ? (
            <Button
              type="button"
              variant="secondary"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? 'Cancel' : `+ ${createLabel}`}
            </Button>
          ) : null}
        </div>
      </div>

      {open && createForm && (
        <Panel padding="none" className="mt-4 p-6">
          {createForm}
        </Panel>
      )}

      <div className={level === 'page' ? 'mt-6' : isEyebrow ? 'mt-3' : 'mt-4'}>{children}</div>
    </section>
  )
}
