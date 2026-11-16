'use client'

import { useSearchParams } from 'next/navigation'
import { PacksApp } from './packs-app'

/** Reads `?open=` so a reload lands on the pack that was open. */
export function PacksRoot() {
  const open = useSearchParams().get('open')
  return <PacksApp initialOpen={open} />
}
