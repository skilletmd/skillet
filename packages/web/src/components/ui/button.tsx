import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentProps } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/cn'
import { CONTROL_HEIGHT } from '@/components/ui/control-size'

/**
 * The one button. Two axes:
 *   variant — what it looks like (primary/secondary/ghost/tertiary/danger/…)
 *   size    — how big it is    (sm / md / lg), default md
 *
 * Every call site is `<Button variant size>`, never a hand-typed padding string.
 * No resting shadows and no hover lift — a button is flat; it changes color on
 * hover and presses in on click. That's the whole motion vocabulary.
 */

// Shared layout, motion, focus, and disabled behavior for the padded family.
// (icon/quiet are standalone controls and skip this base.)
const base =
  'inline-flex items-center justify-center font-semibold leading-none cursor-pointer ease-[var(--ease)] transition-[background-color,border-color,color,opacity,transform] duration-[150ms] focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:outline-offset-2 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:pointer-events-none aria-disabled:cursor-not-allowed aria-disabled:opacity-55'

const button = cva('', {
  variants: {
    variant: {
      // Hover mixes toward --surface (not --accent: in this palette accent is
      // near-ink, so an ink/accent mix reads as no change at all).
      primary: `${base} bg-(--ink) [color:var(--surface)] not-disabled:hover:bg-[color-mix(in_srgb,var(--ink)_82%,var(--surface))] disabled:bg-[color-mix(in_srgb,var(--ink)_34%,var(--surface))] disabled:[color:var(--surface)] disabled:opacity-100`,
      secondary: `${base} border border-(--line) bg-(--surface) [color:var(--ink)] not-disabled:hover:border-[color-mix(in_srgb,var(--line)_65%,var(--ink-2))] not-disabled:hover:bg-(--accent-bg)`,
      ghost: `${base} bg-transparent [color:var(--ink-2)] not-disabled:hover:bg-(--accent-bg) not-disabled:hover:[color:var(--ink)]`,
      tertiary: `${base} bg-transparent [color:var(--ink-2)] p-0 text-sm hover:[color:var(--ink)] hover:underline hover:underline-offset-2`,
      // Accent text link — the inline "Retry" / "Connect an agent →" / "Select all" affordance.
      accent: `${base} bg-transparent [color:var(--accent)] p-0 text-sm hover:underline hover:underline-offset-2`,
      'danger-secondary': `${base} border border-(--danger-line) bg-transparent [color:var(--danger)] not-disabled:hover:bg-(--danger-bg)`,
      'danger-tertiary': `${base} bg-transparent [color:var(--danger)] p-0 text-sm hover:underline hover:underline-offset-2`,
      // Quiet-until-hover destructive — neutral at rest, turns danger on hover.
      // The "Remove / Revoke" row action that shouldn't shout red on every row.
      'danger-ghost': `${base} border border-(--line) bg-(--surface) [color:var(--ink-2)] not-disabled:hover:border-(--danger-line) not-disabled:hover:[color:var(--danger)] not-disabled:hover:bg-(--danger-bg)`,
      // Standalone (no `base`, self-sized) — geometry baked in, ignores `size`.
      row: `${base} rounded-lg bg-(--ink) [color:var(--surface)] px-2.5 py-[5px] text-sm leading-[18px] not-disabled:hover:bg-[color-mix(in_srgb,var(--ink)_82%,var(--surface))]`,
      icon: 'inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-transparent [color:var(--ink-2)] cursor-pointer ease-[var(--ease)] transition-[background-color,color,transform] duration-[140ms] hover:bg-(--accent-bg) hover:[color:var(--ink)] active:scale-[0.97] aria-pressed:[color:var(--ink)] focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:outline-offset-2',
      quiet:
        'inline-flex cursor-pointer items-center gap-1.5 rounded-[7px] bg-transparent px-2.5 py-[5px] text-sm leading-[1.15] [color:var(--ink-2)] ease-[var(--ease)] transition-[background-color,color,transform] duration-[140ms] hover:bg-(--accent-bg) hover:[color:var(--ink)] active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-(--accent) focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-50',
    },
    // Empty on its own — all geometry is applied per-variant via compoundVariants
    // so the self-sized variants (row/icon/quiet/tertiary) are left untouched.
    size: { sm: '', md: '', lg: '' },
  },
  // Geometry per size — only for the padded family; the self-sized variants
  // (row/icon/quiet/tertiary) bake in their own geometry and are left untouched.
  compoundVariants: [
    {
      variant: ['primary', 'secondary', 'ghost', 'danger-secondary', 'danger-ghost'],
      size: 'sm',
      class: `${CONTROL_HEIGHT.sm} gap-1.5 rounded-lg px-3 text-xs`,
    },
    {
      variant: ['primary', 'secondary', 'ghost', 'danger-secondary', 'danger-ghost'],
      size: 'md',
      class: `${CONTROL_HEIGHT.md} gap-2 rounded-lg px-4 text-sm min-w-[88px]`,
    },
    {
      variant: ['primary', 'secondary', 'ghost', 'danger-secondary', 'danger-ghost'],
      size: 'lg',
      class: `${CONTROL_HEIGHT.lg} gap-2 rounded-xl px-5 text-base min-w-[112px]`,
    },
  ],
  defaultVariants: { variant: 'primary', size: 'md' },
})

export type ButtonVariant = NonNullable<VariantProps<typeof button>['variant']>
export type ButtonSize = NonNullable<VariantProps<typeof button>['size']>

/**
 * The raw button classes, for the rare element that can't be a <Button> (e.g. an
 * `<a download>`). Prefer <Button>; reach for this only to keep an exotic element.
 */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  opts?: { size?: ButtonSize; block?: boolean },
) {
  return cn(button({ variant, size: opts?.size }), opts?.block && 'w-full')
}

type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof button> & {
    /** Render as a Next <Link> styled as a button. */
    href?: string
    /** Stretch to fill the container width. */
    block?: boolean
  }

export function Button({ className, variant, size, block, href, ...props }: ButtonProps) {
  const classes = cn(button({ variant, size }), block && 'w-full', className)
  if (href) {
    const { type: _t, ...rest } = props
    // Route handlers (`/api/*`) redirect / set cookies / stream downloads — they
    // must be a plain hard navigation, never a prefetched Next <Link> (prefetch
    // would execute the side-effecting GET before the click).
    if (href.startsWith('/api/')) {
      return <a href={href} className={classes} {...(rest as Omit<ComponentProps<'a'>, 'href'>)} />
    }
    return (
      <Link
        href={href}
        className={classes}
        {...(rest as Omit<ComponentProps<typeof Link>, 'href'>)}
      />
    )
  }
  return <button className={classes} {...props} />
}
