'use client'

import { Avatar } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { Check, ChevronDown } from '@/components/ui/icons'

/** A handle the signed-in user is allowed to publish under: themselves, or a
 *  team they own/admin. Drives the "Publish as" selector wherever publishing
 *  happens (new skill, GitHub import). */
export interface PublishAsTarget {
  handle: string
  name: string
  kind: 'you' | 'team'
  /** Avatar/logo URL; falls back to an illustrated face (you) or monogram (team). */
  avatarUrl?: string | null
}

/**
 * Visual "Publish as" picker: avatar + name. Renders a dropdown when the user
 * can publish under a team, or a static pill when it's just them.
 */
export function PublishAsControl({
  targets,
  value,
  onChange,
}: {
  targets: PublishAsTarget[]
  value: string
  onChange: (handle: string) => void
}) {
  const current = targets.find((t) => t.handle === value) ?? targets[0]
  if (!current) return null

  const face = (t: PublishAsTarget, size: 'xs' | 'sm') => (
    <Avatar
      size={size}
      src={t.avatarUrl}
      name={t.name}
      colorKey={t.handle}
      kind={t.kind === 'team' ? 'team' : 'person'}
    />
  )

  if (targets.length <= 1) {
    return (
      <span
        className="flex min-h-10 items-center gap-2 rounded-lg border border-(--line) bg-(--surface) px-2 pr-3"
        title="Publishing as you"
      >
        {face(current, 'xs')}
        <span className="text-sm font-medium text-(--ink)">{current.name}</span>
      </span>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Publish as"
          className="flex min-h-10 items-center gap-2 rounded-lg border border-(--line) bg-(--surface) px-2 pr-2.5 text-(--ink) transition hover:border-(--ink-2)"
        >
          {face(current, 'xs')}
          <span className="text-sm font-medium">{current.name}</span>
          <ChevronDown className="h-3.5 w-3.5 text-(--ink-2)" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px]">
        <DropdownMenuLabel>Publish as</DropdownMenuLabel>
        {targets.map((t) => (
          <DropdownMenuItem
            key={t.handle}
            onSelect={() => onChange(t.handle)}
            className="flex items-center gap-2.5"
          >
            {face(t, 'sm')}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-(--ink)">{t.name}</span>
              <span className="block truncate font-mono text-xs text-(--ink-2)">
                @{t.handle}
                {t.kind === 'you' ? ' · you' : ''}
              </span>
            </span>
            {t.handle === value && <Check className="h-4 w-4 shrink-0 text-(--accent)" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
