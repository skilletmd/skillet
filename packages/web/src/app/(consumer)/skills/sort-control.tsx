'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface SortOption {
  value: string
  label: string
}

// Everything defaults to 'new': Featured owns the popularity charts, so the full
// catalog is the "what's fresh" view. The default value carries no param — see
// the `defaultValue` prop below.
export const CONTENT_SORTS: SortOption[] = [
  { value: 'new', label: 'Newest' },
  { value: 'popular', label: 'Popular' },
  { value: 'alpha', label: 'A–Z' },
]
export const PEOPLE_SORTS: SortOption[] = [
  { value: 'new', label: 'Newest' },
  { value: 'popular', label: 'Installs' },
  { value: 'followers', label: 'Followers' },
  { value: 'alpha', label: 'A–Z' },
]

/**
 * Result sort for the directory. A quiet menu, not a segmented control: sort is
 * a refinement that sits subordinate to the type tabs, and a menu stays calm
 * whether there are three options or seven. The `defaultValue` sort carries no
 * param. Changing sort resets to the first page and preserves the other filters
 * (type / category / q) by editing the live search params.
 */
export function SortControl({
  options = CONTENT_SORTS,
  defaultValue = 'new',
}: {
  options?: SortOption[]
  /** The sort that's active with no `sort` param in the URL. Must match the
   *  server-side default in parseBrowseQuery. */
  defaultValue?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const current = params.get('sort') ?? defaultValue
  const currentLabel = options.find((o) => o.value === current)?.label ?? options[0].label

  function choose(value: string) {
    const next = new URLSearchParams(params.toString())
    if (value === defaultValue) next.delete('sort')
    else next.set('sort', value)
    next.delete('offset') // a new sort always starts at the first page
    const query = next.toString()
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Sort results"
        className={`group inline-flex h-11 items-center gap-1.5 rounded-md px-0.5 text-sm font-medium text-(--ink-2) outline-none transition-colors hover:text-(--ink) focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--accent) data-[state=open]:text-(--ink) ${isPending ? 'opacity-60' : ''}`}
      >
        Sort:<span className="font-semibold text-(--ink)">{currentLabel}</span>
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 4.5 6 7.5 9 4.5" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {options.map((o) => {
          const active = current === o.value
          return (
            <DropdownMenuItem
              key={o.value}
              onSelect={() => choose(o.value)}
              className={
                active ? 'font-semibold text-(--accent) data-[highlighted]:text-(--accent)' : ''
              }
            >
              {o.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
