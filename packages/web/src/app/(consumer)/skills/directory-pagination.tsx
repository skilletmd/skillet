'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useTransition } from 'react'
import { ArrowLeft, ArrowRight } from '@/components/ui/icons'
import { Button } from '@/components/ui/button'

interface Props {
  total: number
  limit: number
  offset: number
}

/**
 * Prev / Next pager wired to the `?offset=` URL param (the same value passed
 * to `GET /v1/skills`). Page math is derived from the envelope's `total`,
 * `limit`, and `offset`, so it stays correct under search.
 */
export function DirectoryPagination({ total, limit, offset }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()

  if (total <= limit) return null

  const pageCount = Math.ceil(total / limit)
  // Clamp so a hand-edited out-of-range offset reads "Page 3 of 3", not "417 of 3".
  const page = Math.min(Math.floor(offset / limit) + 1, pageCount)
  const hasPrev = offset > 0
  const hasNext = offset + limit < total

  function go(nextOffset: number) {
    const params = new URLSearchParams(searchParams.toString())
    if (nextOffset > 0) {
      params.set('offset', String(nextOffset))
    } else {
      params.delete('offset')
    }
    const query = params.toString()
    startTransition(() => {
      router.push(query ? `${pathname}?${query}` : pathname)
    })
  }

  return (
    <nav
      aria-label="Pagination"
      aria-busy={isPending}
      className="mt-10 flex items-center justify-between gap-4"
    >
      <Button
        type="button"
        variant="secondary"
        onClick={() => go(Math.max(0, offset - limit))}
        disabled={!hasPrev || isPending}
      >
        <ArrowLeft /> Previous
      </Button>
      <span className="font-mono text-sm text-(--ink-2)">
        Page {page} of {pageCount}
      </span>
      <Button
        type="button"
        variant="secondary"
        onClick={() => go(offset + limit)}
        disabled={!hasNext || isPending}
      >
        Next <ArrowRight />
      </Button>
    </nav>
  )
}
