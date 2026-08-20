'use client'

import { useEffect, useRef } from 'react'
import { useToast } from '@/components/ui/toast'
import type { ClaimResult } from '@/components/mirror-notice'

/**
 * Fires a one-shot toast for a SUCCESSFUL claim outcome (read from the cleared-on-
 * read result cookie by the brand page). Success is transient confirmation, so it
 * belongs in a toast, not a persistent bar. Denial/remediation outcomes
 * (NOT_ELIGIBLE / DENIED / INDETERMINATE) keep their inline notice instead, since
 * they carry next steps the user needs to read.
 */
export function ClaimResultToast({ result }: { result: ClaimResult }) {
  const toast = useToast()
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    if (result.classification === 'ELIGIBLE') {
      toast({ message: `You now manage @${result.handle}.` })
    } else if (result.classification === 'ALREADY_MANAGED') {
      toast({ message: `@${result.handle} is already managed by its owner.` })
    }
  }, [result, toast])

  return null
}
