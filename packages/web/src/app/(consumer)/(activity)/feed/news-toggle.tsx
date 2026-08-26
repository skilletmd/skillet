'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { NEWS_OFF_PARAM, parseNewsOff } from './feed-lens'

/**
 * News in or out, on the lens row.
 *
 * Replaces an Everything / News / Activity pill group. Three pills asked the
 * reader to pick a mode when the only thing they actually want to say is
 * whether the outside world belongs in their feed today. That is a yes/no, so
 * it is a checkbox.
 *
 * Still a real URL (`?news=0`), so the server renders the right list directly
 * and the state survives a reload or a shared link. `replace` rather than
 * `push`, because toggling a filter is not somewhere you navigated to and
 * should not need a Back press to escape.
 */
export function NewsToggle() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const off = parseNewsOff(params.get(NEWS_OFF_PARAM) ?? undefined)

  function toggle() {
    const next = new URLSearchParams(params)
    if (off) next.delete(NEWS_OFF_PARAM)
    else next.set(NEWS_OFF_PARAM, '0')
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  return (
    <label className="ml-auto flex shrink-0 cursor-pointer items-center gap-2 pb-2 text-sm text-(--ink-2) select-none hover:text-(--ink)">
      <input
        type="checkbox"
        checked={!off}
        onChange={toggle}
        className="h-3.5 w-3.5 cursor-pointer accent-(--accent)"
      />
      News
    </label>
  )
}
