'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Copy text to the clipboard and flash a confirmation. `copied` flips to true on
 * a successful write and auto-resets to false after `resetMs`; the reset timer is
 * cleared on unmount so it never sets state on a gone component. A `writeText`
 * rejection (e.g. clipboard blocked) is swallowed and leaves `copied` false.
 */
export function useCopyToClipboard(resetMs = 1500): {
  copied: boolean
  copy: (text: string) => Promise<void>
} {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), resetMs)
      } catch {
        // clipboard blocked — leave copied=false; the text is visible to copy by hand
      }
    },
    [resetMs],
  )

  return { copied, copy }
}
