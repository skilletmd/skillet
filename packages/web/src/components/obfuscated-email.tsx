'use client'

import { useEffect, useState } from 'react'

// Anti-scrape email. The `user@domain` string never appears in the server-
// rendered HTML — before hydration we show a `user [at] domain [dot] tld`
// text fallback, and only assemble the real `mailto:` link in the browser
// after mount. Basic harvesters that read the SSR output (or don't run JS)
// never see a usable address; humans get a working link.
export function ObfuscatedEmail({
  user,
  domain,
  subject,
  className,
}: {
  /** Local part, e.g. `skilletdotmd`. */
  user: string
  /** Domain, e.g. `gmail.com`. */
  domain: string
  subject?: string
  className?: string
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  if (!mounted) {
    const dotted = domain.replace(/\./g, ' [dot] ')
    return (
      <span className={className}>
        {user} [at] {dotted}
      </span>
    )
  }

  const address = `${user}@${domain}`
  const href = subject ? `mailto:${address}?subject=${encodeURIComponent(subject)}` : `mailto:${address}`
  return (
    <a className={className} href={href}>
      {address}
    </a>
  )
}
