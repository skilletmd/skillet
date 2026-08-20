import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

/**
 * The standard dialog action row — a top-margined flex row of buttons. One
 * wrapper so every dialog footer shares the same spacing. `layout="end"`
 * (default) right-aligns the buttons (Cancel / Confirm); `layout="between"`
 * spreads them (a left action against a right one).
 */
export function DialogFooter({
  layout = 'end',
  className,
  ...props
}: ComponentProps<'div'> & { layout?: 'end' | 'between' }) {
  return (
    <div
      className={cn(
        'mt-5 flex gap-3',
        layout === 'between' ? 'justify-between' : 'justify-end',
        className,
      )}
      {...props}
    />
  )
}
