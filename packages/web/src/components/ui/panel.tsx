import type { ComponentProps, ElementType } from 'react'
import { cn } from '@/lib/cn'

/**
 * The standard surface panel — a bordered `--surface` card. One wrapper so the
 * ~50 hand-rolled `rounded-2xl border border-(--line) bg-(--surface) p-…` shells
 * across the app share a radius, border, and padding scale. `elevated` adds the
 * raised-card shadow token; reach for `padding="none"` when the panel hosts its
 * own divided rows. Pass `as` to render a semantic element (`section`, `article`,
 * `ul`, …) while keeping the shared surface styling.
 */
const PADDING = {
  none: '',
  sm: 'p-4',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
} as const

export function Panel({
  as: Tag = 'div',
  padding = 'md',
  elevated = false,
  className,
  ...props
}: ComponentProps<'div'> & { as?: ElementType; padding?: keyof typeof PADDING; elevated?: boolean }) {
  return (
    <Tag
      className={cn(
        'rounded-2xl border border-(--line) bg-(--surface)',
        PADDING[padding],
        elevated && 'shadow-(--shadow-md)',
        className,
      )}
      {...props}
    />
  )
}
