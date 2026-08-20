import { renderOgImage } from '@/app/api/og/render'
import { OG } from '@/lib/og'

export const runtime = 'nodejs'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function DocsOGImage() {
  return renderOgImage(OG.docs())
}
