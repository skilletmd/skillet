import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

/**
 * One inline notice/banner treatment for the whole app — a rounded bordered band
 * in one of three tones. Replaces the hand-rolled status/error divs that drifted
 * across settings pages. `danger` announces as an alert; the quieter tones as a
 * status. Drop it at the top of a page's content.
 */
const TONES = {
  info: 'border-(--line) bg-(--accent-bg) text-(--ink)',
  success: 'border-(--success-line)/60 bg-(--success-bg) text-(--success)',
  danger: 'border-(--danger-line)/50 bg-(--danger-bg) text-(--danger)',
} as const

export function Notice({
  tone = 'info',
  className,
  children,
}: {
  tone?: keyof typeof TONES
  className?: string
  children: ReactNode
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('rounded-xl border px-4 py-3 text-sm leading-relaxed', TONES[tone], className)}
    >
      {children}
    </div>
  )
}
