'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * Search box wired to the `?q=` URL param that drives `GET /v1/skills`.
 * Submitting (or clearing) navigates to a fresh first page (offset dropped)
 * so results and pagination stay consistent. `useTransition` surfaces the
 * in-flight server fetch as a pending state without blocking typing.
 */
export function DirectorySearch({
  initialQuery,
  placeholder = 'Search skills…',
  label = 'Search skills',
}: {
  initialQuery: string
  placeholder?: string
  label?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [value, setValue] = useState(initialQuery)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep the field in sync when the query changes from outside (e.g. back/forward).
  useEffect(() => {
    setValue(initialQuery)
  }, [initialQuery])

  function commit(next: string) {
    const params = new URLSearchParams(searchParams.toString())
    const trimmed = next.trim()
    if (trimmed) {
      params.set('q', trimmed)
    } else {
      params.delete('q')
    }
    // A new search always returns to the first page.
    params.delete('offset')
    const query = params.toString()
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname)
    })
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    commit(value)
  }

  function onClear() {
    setValue('')
    commit('')
    inputRef.current?.focus()
  }

  return (
    <form onSubmit={onSubmit} role="search" className="relative max-w-[420px]">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-(--ink-2)"
      >
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
          <circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10 10l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </span>
      <Input
        ref={inputRef}
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        className="h-9 pl-9 pr-20 text-sm"
      />
      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
        {isPending && (
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 animate-spin rounded-full border-[1.5px] border-(--line) border-t-(--accent)"
          />
        )}
        {value && (
          <Button type="button" variant="icon" onClick={onClear} aria-label="Clear search">
            ✕
          </Button>
        )}
      </div>
    </form>
  )
}
