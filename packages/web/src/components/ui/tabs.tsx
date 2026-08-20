import Link from 'next/link'
import type { ComponentProps } from 'react'
import { cn } from '@/lib/cn'

/** Underline tab bar (the gold active indicator is a `::after`, kept in CSS). */
export function TabBar({ className, ...props }: ComponentProps<'nav'>) {
  return <nav className={cn('feed-tabs', className)} {...props} />
}

/** A tab — a Next <Link> when `href` is set, otherwise a <button>. */
export function Tab({
  active,
  href,
  className,
  ...props
}: ComponentProps<'button'> & { active?: boolean; href?: string }) {
  const classes = cn('feed-tab', active && 'is-active', className)
  if (href) {
    const { type: _type, ...rest } = props
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
