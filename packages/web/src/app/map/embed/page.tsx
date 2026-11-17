import type { Metadata } from 'next'
import { MapEmbed } from './map-embed'

// Framed by the page `skillet map` serves on the person's computer. proxy.ts
// gives this one path its own security headers: loopback-only framing, and no
// connection or image that isn't inline (lib/security-headers.ts).
export const metadata: Metadata = {
  title: 'Your kit map · Skillet',
  description: 'Every skill on your computer, sorted into the job it does.',
  robots: { index: false, follow: false },
}

export default function MapEmbedPage() {
  return <MapEmbed />
}
