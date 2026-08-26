'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { CONTENT_SORTS, PEOPLE_SORTS } from '../skills/sort-control'
import { browseTypes, type BrowseViewKind } from './browse-chrome'

/**
 * The phone's result controls, as one bare funnel.
 *
 * Type and Sort used to be a second chrome row of their own — 46px above the
 * fold for two controls most visits never touch. Then two labelled dropdowns on
 * the strip, which fit but left the bar reading as five nav items plus two
 * settings. One glyph, one menu: the categories stay visible (they are the
 * browsing), and the refinements are one tap away.
 *
 * The trigger tints to the accent whenever a non-default filter is on, so a
 * narrowed list never looks like the whole catalog — that is the whole price of
 * hiding these behind a glyph, and it is worth paying once here.
 */
export function ResultFilterMenu({ category, view }: { category: string; view: BrowseViewKind }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [isPending, startTransition] = useTransition()

  const types = browseTypes(category)
  const sorts = view === 'people' ? PEOPLE_SORTS : CONTENT_SORTS
  const currentSort = params.get('sort') ?? 'new'
  const filtered = view !== 'all' || currentSort !== 'new'

  function chooseSort(value: string) {
    const next = new URLSearchParams(params.toString())
    if (value === 'new') next.delete('sort')
    else next.set('sort', value)
    next.delete('offset') // a new sort always starts at the first page
    const query = next.toString()
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname))
  }

  const activeItem = 'font-semibold text-(--accent) data-[highlighted]:text-(--accent)'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Filter and sort results"
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md outline-none transition-colors hover:bg-(--accent-bg) hover:text-(--ink) data-[state=open]:bg-(--accent-bg) data-[state=open]:text-(--ink) ${
          filtered ? 'text-(--accent)' : 'text-(--ink-2)'
        } ${isPending ? 'opacity-60' : ''}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          className="h-[18px] w-[18px]"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 3.5h11l-4.2 5v4.2l-2.6 1.3V8.5z" />
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        {types.map((t) => (
          <DropdownMenuItem key={t.key} asChild>
            <Link
              href={t.href}
              prefetch={false}
              scroll={false}
              className={t.key === view ? activeItem : ''}
            >
              {t.label}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Sort</DropdownMenuLabel>
        {sorts.map((o) => (
          <DropdownMenuItem
            key={o.value}
            onSelect={() => chooseSort(o.value)}
            className={currentSort === o.value ? activeItem : ''}
          >
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
