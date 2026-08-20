import { renderOgImage } from '@/app/api/og/render'
import { OG } from '@/lib/og'

export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// Branded home card via the shared renderer, so it matches every other share
// card (and the /lab/og gallery). Renders on-demand, CDN-cached.
export default function DefaultOGImage() {
  return renderOgImage(OG.home())
}
