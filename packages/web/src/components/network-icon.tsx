/**
 * Where a post came from, as a mark rather than the words "on X".
 *
 * Each is the network's own glyph, drawn at a single weight so a row of mixed
 * sources reads as one set instead of three pasted logos. They inherit
 * `currentColor` so the byline controls the tone, except Reddit and HN, whose
 * marks are only recognisable in their own colour.
 */

export type Network = 'x' | 'hn' | 'reddit'

export const NETWORK_NAME: Record<Network, string> = {
  x: 'X',
  hn: 'Hacker News',
  reddit: 'Reddit',
}

export function NetworkIcon({ network, className = '' }: { network: Network; className?: string }) {
  const size = `h-3.5 w-3.5 shrink-0 ${className}`

  if (network === 'x') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={size} fill="currentColor">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    )
  }

  if (network === 'hn') {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" className={size}>
        <rect width="24" height="24" rx="3" fill="#ff6600" />
        <path
          d="M12 13.2 8.1 6h2.05l2.02 4.02c.04.08.08.17.12.26.04-.1.08-.19.13-.28L14.42 6h1.9l-3.86 7.18V18h-1.6z"
          fill="#fff"
        />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={size}>
      <circle cx="12" cy="12" r="12" fill="#ff4500" />
      <path
        d="M19.2 12a1.63 1.63 0 0 0-2.76-1.17 8.02 8.02 0 0 0-4.36-1.39l.74-3.5 2.43.52a1.16 1.16 0 1 0 .13-.76l-2.79-.59a.39.39 0 0 0-.46.3l-.83 3.9v.13a8.02 8.02 0 0 0-4.36 1.39A1.63 1.63 0 1 0 5.3 14.1a3.2 3.2 0 0 0-.04.5c0 2.55 2.97 4.62 6.63 4.62s6.63-2.07 6.63-4.62a3.2 3.2 0 0 0-.04-.5c.44-.28.72-.77.72-1.3zM8.5 13.2a1.16 1.16 0 1 1 2.32 0 1.16 1.16 0 0 1-2.32 0zm6.53 3.1c-.8.8-2.32.86-2.77.86s-1.98-.06-2.77-.86a.3.3 0 0 1 .43-.43c.5.5 1.58.68 2.34.68s1.83-.18 2.34-.68a.3.3 0 1 1 .43.43zm-.2-1.94a1.16 1.16 0 1 1 0-2.32 1.16 1.16 0 0 1 0 2.32z"
        fill="#fff"
      />
    </svg>
  )
}
