'use client'

import { useState } from 'react'

/**
 * A bundle-resolved markdown image. The client-side resolver already vetted
 * existence, extension, and size, so a failure here is a residual server-side
 * one (corrupt blob, outage) — any load error unmounts the element entirely:
 * a broken-image icon must never be reachable from a skill page.
 */
export function BundleImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <img src={src} alt={alt} loading="lazy" className="max-w-full" onError={() => setFailed(true)} />
}
