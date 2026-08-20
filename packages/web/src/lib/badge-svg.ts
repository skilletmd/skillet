import { compactCount } from '@/lib/format-count'

// Shared README-badge renderer. Two styles from one builder so skills and kits
// look identical: `flat` (shields-style, info + count) and `button` (a cute solid
// CTA with the Skillet mark, like "Deploy to Vercel"). Hand-built SVG — no fonts,
// no next/og — so it's tiny, edge-cacheable, and renders through GitHub's proxy.

const INK = '#1a1915'
const ACCENT = '#2f6f8f'
const ACCENT_DARK = '#255a73'
const MARK_LIGHT = '#9ac5d8' // mark on the dark flat segment
const TEXT = '#ffffff'

export type BadgeStyle = 'flat' | 'button'

const FONT_STACK = 'Verdana,Geneva,DejaVu Sans,sans-serif'

export const compact = (n: number) => compactCount(n)

// Verdana ~6.6px/char at 11px, ~7.1px at 12px; a hair generous beats clipping.
const textWidth = (s: string, size: number) => Math.ceil(s.length * (size * 0.6))

function escAttr(s: string) {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  )
}

/** Escape text node content — apostrophe is safe literally in SVG `<text>`. */
function escText(s: string) {
  return s.replace(/[<>&"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;',
  )
}

/** The Skillet mark (chevron · open-ring eye · smile) from app/icon.tsx, scaled into a box. */
function logoMark(x: number, y: number, box: number, color: string) {
  const s = box / 32
  return `<g transform="translate(${x},${y}) scale(${s.toFixed(4)})" fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round">
    <g transform="translate(2,2)">
      <path d="M6.2 10.3 13.2 15.2 6.2 20.1" stroke-width="2.7"/>
      <circle cx="21.8" cy="15.2" r="2.5" stroke-width="1.7"/>
      <path d="M12.2 21.2c2 2.3 5.2 2.3 7.2 0" stroke-width="2.4"/>
    </g>
  </g>`
}

/** `flat`: two segments, brand on the left, value on the right. */
function flat(label: string, message: string) {
  const H = 20
  const fs = 11
  const padH = 8
  const logoBox = 14
  const markSpace = padH + logoBox + 6 // pad · logo · gap, before the label text
  const labelW = markSpace + textWidth(label, fs) + padH
  const msgW = padH + textWidth(message, fs) + padH
  const W = labelW + msgW

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${escAttr(label)}: ${escAttr(message)}">
  <title>${escAttr(label)}: ${escAttr(message)}</title>
  <clipPath id="r"><rect width="${W}" height="${H}" rx="3"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelW}" height="${H}" fill="${INK}"/>
    <rect x="${labelW}" width="${msgW}" height="${H}" fill="${ACCENT}"/>
  </g>
  ${logoMark(padH, 3, logoBox, MARK_LIGHT)}
  <g fill="${TEXT}" font-family="${FONT_STACK}" font-size="${fs}">
    <text x="${markSpace}" y="14">${escText(label)}</text>
    <text x="${labelW + msgW / 2}" y="14" text-anchor="middle">${escText(message)}</text>
  </g>
</svg>`
}

/** `button`: a solid, rounded CTA with the mark — reads as a clickable button. */
function button(message: string) {
  const H = 28
  const fs = 12.5
  const padH = 12
  const logoBox = 18
  const gap = 8
  const textX = padH + logoBox + gap
  const W = textX + textWidth(message, fs) + padH

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" role="img" aria-label="${escAttr(message)} (Skillet)">
  <title>${escAttr(message)} (Skillet)</title>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="7" fill="${ACCENT}" stroke="${ACCENT_DARK}"/>
  ${logoMark(padH, (H - logoBox) / 2, logoBox, TEXT)}
  <text x="${textX}" y="${H / 2 + fs * 0.35}" fill="${TEXT}" font-family="${FONT_STACK}" font-size="${fs}" font-weight="bold">${escText(message)}</text>
</svg>`
}

/** Build a badge SVG. `flat` uses label+message; `button` uses message as the CTA. */
export function renderBadge(opts: { style: BadgeStyle; label?: string; message: string }): string {
  return opts.style === 'button'
    ? button(opts.message)
    : flat(opts.label ?? 'skillet', opts.message)
}

const HEADERS = {
  'content-type': 'image/svg+xml; charset=utf-8',
  // Cache at the edge, refresh counts within the hour.
  'cache-control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
} as const

export function badgeResponse(svg: string): Response {
  return new Response(svg, { headers: HEADERS })
}
