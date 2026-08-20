import type { ReactNode, ElementType } from 'react'
import { cn } from '@/lib/cn'

/**
 * One setting row: an optional leading icon + title + description on the left and
 * a trailing control on the right — toggle, badge, button, etc. Carries its own
 * row padding so it drops straight into a {@link SettingsList} grouped card (the
 * dividers come from the list). One wrapper so every settings/linked-account/
 * device/repo row shares the same height, typography, and alignment. Pass
 * `as="li"` inside a list. Leading glyphs in the `icon` slot are ~20px
 * (`h-5 w-5`) at full `--ink` — the one list-row glyph treatment.
 */
export function SettingRow({
  title,
  description,
  icon,
  children,
  className,
  as: Tag = 'div',
}: {
  title: ReactNode
  description?: ReactNode
  /** Optional leading glyph (e.g. a provider logo on linked-account rows). */
  icon?: ReactNode
  /** The trailing control — toggle, badge, button. */
  children?: ReactNode
  className?: string
  as?: ElementType
}) {
  return (
    <Tag className={cn('flex items-center justify-between gap-4 px-4 py-3', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {icon && <span className="shrink-0 text-(--ink)">{icon}</span>}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-(--ink)">{title}</p>
          {description && <p className="mt-0.5 text-sm leading-snug text-(--ink-2)">{description}</p>}
        </div>
      </div>
      {children && <div className="shrink-0">{children}</div>}
    </Tag>
  )
}
