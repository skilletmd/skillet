'use client'

import { useState, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { disconnectProviderAction } from '@/app/(consumer)/settings/account-actions'

/** Horizontal ellipsis trigger — matches the connected-repo row's manage menu. */
function EllipsisIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  )
}

/**
 * The trailing control for a CONNECTED linked-account row: the "connected" badge
 * plus a kebab whose only item is Disconnect — destructive action kept one layer
 * down, same pattern as the connected-repo rows. The registry enforces the
 * lockout guard (can't remove your last sign-in method); we surface its error.
 */
export function LinkedAccountMenu({
  provider,
  label,
}: {
  provider: 'github' | 'twitter'
  label: string
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function disconnect() {
    setError(null)
    startTransition(async () => {
      const res = await disconnectProviderAction(provider)
      if (!res.ok) setError(res.error ?? 'Could not disconnect.')
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1.5">
        <Badge variant="success">connected</Badge>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Manage ${label}`}
            disabled={pending}
            className="flex h-8 w-8 items-center justify-center rounded-md text-(--ink-2) outline-none transition-colors hover:bg-(--accent-bg) hover:text-(--ink) data-[state=open]:bg-(--bg) data-[state=open]:text-(--ink)"
          >
            <EllipsisIcon className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem variant="destructive" onSelect={disconnect}>
              Disconnect {label}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error && <p className="text-xs text-(--danger)">{error}</p>}
    </div>
  )
}
