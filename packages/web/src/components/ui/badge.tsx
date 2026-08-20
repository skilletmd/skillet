import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

/** Small status pill. Tailwind + tokens; one source of truth for every badge. */
const badge = cva(
  'inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-xs uppercase leading-4 tracking-[0.04em]',
  {
    variants: {
      variant: {
        default: 'border-(--line) bg-(--surface) text-(--ink-2)',
        accent: 'border-(--accent) bg-(--accent-bg) text-(--accent)',
        success: 'border-(--success-line) bg-(--success-bg) text-(--success)',
        danger: 'border-(--danger-line) bg-(--danger-bg) text-(--danger)',
        warning:
          'border-(--warning-line)/30 bg-(--warning-bg) text-(--warning) dark:border-(--warning-line)/40 dark:bg-(--warning-bg)/50 dark:text-(--warning)',
        'danger-soft': 'border-(--danger)/30 bg-(--danger)/10 text-(--danger)',
        'accent-soft': 'border-transparent bg-(--accent-bg) text-(--accent)',
      },
      /**
       * `pill` — the canonical uppercase status pill.
       * `chip` — lowercase, icon-bearing chip (gap + roomier padding) used by
       *   the security / deprecated / pending badges.
       */
      appearance: {
        pill: '',
        chip: 'gap-1.5 px-3 normal-case leading-none tracking-normal',
      },
    },
    defaultVariants: { variant: 'default', appearance: 'pill' },
  },
)

export type BadgeVariant = NonNullable<VariantProps<typeof badge>['variant']>

export function Badge({
  className,
  variant,
  appearance,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ variant, appearance }), className)} {...props} />
}
