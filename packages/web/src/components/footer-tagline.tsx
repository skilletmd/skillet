'use client'

import { useEffect, useState } from 'react'

// A little kitchen personality next to the mascot — rotates on each load.
// Idioms that double as a nod to Skillet: skilled, in place, shared.
const PHRASES = [
  'seasoned to taste',
  'mise en place',
  'everybody eats',
  "let 'em cook",
  'low and slow',
  'always something on',
] as const

export function FooterTagline() {
  // Server + first client render share index 0 (no hydration mismatch); a random
  // phrase is picked after mount, so it rotates per visit.
  const [i, setI] = useState(0)
  useEffect(() => {
    setI(Math.floor(Math.random() * PHRASES.length))
  }, [])
  return (
    <span className="text-(--ink-2) italic" aria-hidden="true">
      {PHRASES[i]}
    </span>
  )
}
