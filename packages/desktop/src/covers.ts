/**
 * Skill/kit covers for the desktop — thin wrappers over the shared engine in
 * @skillet/protocol, so web and desktop render from ONE source of truth. Change
 * the art there and every surface updates.
 *
 * Skills carry a `category` (delivered via the sync manifest) — when present the
 * cover is identical to the web's for that skill; otherwise we fall back to the
 * shared seed category (right style, deterministic per skill).
 */
// Import the covers subpath directly — the protocol barrel pulls in node:crypto
// (bundle/delegation signing), which can't bundle for the browser.
import { coverSvg, seedCategory } from '@skillet/protocol/covers'
import { coverPaintAttrs } from './cover-paint'

function isDark(): boolean {
  const el = document.documentElement
  if (el.classList.contains('preview-dark')) return true
  if (el.classList.contains('preview-light')) return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

/** A soft-amber "attention" cover with a bell glyph — the pinned update CTA on
 *  Activity. Warm accent so the one actionable thing has a quiet heartbeat. */
export function updateCover(): string {
  const dark = isDark()
  const ground = dark ? 'hsl(40 34% 30%)' : 'hsl(42 85% 89%)'
  const glyph = dark ? 'hsl(42 70% 72%)' : 'hsl(34 74% 44%)'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect x="-1" y="-1" width="122" height="122" fill="${ground}"/><g transform="translate(30 32) scale(2.5)" fill="none" stroke="${glyph}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></g></svg>`
}

/** A single skill's cover. The SVG engine paints instantly; when the skill
 *  has a category, `data-cover` attributes let the shared canvas engine
 *  paint the roll over it (installCoverPainting hydrates after render), so
 *  tray tiles match the web exactly. Uncategorized skills stay on the shared
 *  SVG placeholder. */
export function skillCover(ref: string, category?: string | null): string {
  const svg = coverSvg(ref, category ? [category] : [], { dark: isDark(), listMark: true })
  const attrs = coverPaintAttrs(ref, [category])
  return attrs ? `<span class="cover-paint" style="position:relative;display:block;width:100%;height:100%"${attrs}>${svg}</span>` : svg
}

/** A distinct cover for the "Not synced" group — a neutral ground + a cloud-with-
 *  slash glyph, so local skills read as a sync STATE (not backed up) rather than a
 *  location, and never look like a synced kit. */
export function localCover(): string {
  const dark = isDark()
  const ground = dark ? 'hsl(38 6% 26%)' : 'hsl(38 12% 87%)'
  const glyph = dark ? 'hsl(38 9% 68%)' : 'hsl(38 10% 44%)'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect x="-1" y="-1" width="122" height="122" fill="${ground}"/><g transform="translate(30 33) scale(2.5)" fill="none" stroke="${glyph}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H7a4.5 4.5 0 0 1-1.3-8.8"/><path d="M9 5.5A5 5 0 0 1 18.5 8a4 4 0 0 1 2.4 6.7"/><path d="M3 3l18 18"/></g></svg>`
}

/** SVG string for a kit's cover — a flat ground in the dominant category hue.
 *  Uses each member's real category when known, else the shared seed fallback (one
 *  per member, which also seeds the painted cover's per-category waves). */
export function kitCover(members: { ref: string; category?: string | null }[]): string {
  const seed = members.map((m) => m.ref).join('|') || 'empty-kit'
  const cats = members.length
    ? members.map((m) => m.category ?? seedCategory(m.ref))
    : [seedCategory(seed)]
  const svg = coverSvg(seed, cats, { dark: isDark() })
  // The painted category waves (see skillCover) render over this instant ground
  // once installCoverPainting hydrates — one wave per member category.
  const attrs = coverPaintAttrs(seed, cats)
  return attrs ? `<span class="cover-paint" style="position:relative;display:block;width:100%;height:100%"${attrs}>${svg}</span>` : svg
}
