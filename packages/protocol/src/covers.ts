/**
 * Deterministic skill/kit cover art — the instant, framework-agnostic layer,
 * shared by web and desktop. Returns an SVG *string* each surface inlines (web via
 * dangerouslySetInnerHTML, desktop via innerHTML). Change the engine here and
 * every surface updates.
 *
 * This SVG layer renders three forms:
 *   - a categorized skill: a category-tinted squircle + the category glyph (the
 *     app-icon cover);
 *   - an uncategorized skill: a neutral "not decided yet" ground (+ a quiet mark
 *     at list sizes);
 *   - a kit: a flat ground in the dominant category hue.
 *
 * The painted cover (canvas print, see the web cover-canvas) is the visible art
 * for kits and categorized skills. This SVG is what shows instantly, and for a
 * kit it is only the pre-hydration underlay or the hidden ground behind an avatar
 * — so its kit form is a plain tint that matches the painted cover's fallback,
 * not its own art. (Paper grain is a web-only overlay, omitted here.)
 */

export type CategorySection = 'Code' | 'Grow' | 'Create'
export type CategoryKey =
  | 'frontend' | 'mobile' | 'backend' | 'database' | 'devops' | 'security'
  | 'quality' | 'agents' | 'design' | 'product' | 'research' | 'writing'
  | 'marketing' | 'sales' | 'finance' | 'productivity' | 'media'

// key → { label (drives the alphabetical ramp sweep), section }. Kept in sync
// with packages/web/src/lib/categories.ts (which layers browse metadata on top).
const CATEGORY_DEFS: { key: CategoryKey; label: string; section: CategorySection }[] = [
  { key: 'frontend', label: 'Frontend', section: 'Code' },
  { key: 'mobile', label: 'Mobile', section: 'Code' },
  { key: 'backend', label: 'Backend', section: 'Code' },
  { key: 'database', label: 'Data', section: 'Code' },
  { key: 'devops', label: 'DevOps', section: 'Code' },
  { key: 'security', label: 'Security', section: 'Code' },
  { key: 'quality', label: 'Code Review', section: 'Code' },
  { key: 'agents', label: 'AI', section: 'Code' },
  { key: 'design', label: 'Design', section: 'Create' },
  { key: 'product', label: 'Strategy', section: 'Grow' },
  { key: 'research', label: 'Research', section: 'Grow' },
  { key: 'writing', label: 'Writing', section: 'Create' },
  { key: 'marketing', label: 'Marketing', section: 'Grow' },
  { key: 'sales', label: 'Sales', section: 'Grow' },
  { key: 'finance', label: 'Finance', section: 'Grow' },
  { key: 'productivity', label: 'Productivity', section: 'Grow' },
  { key: 'media', label: 'Media', section: 'Create' },
]

const CATEGORY_SECTIONS: CategorySection[] = ['Code', 'Create', 'Grow']

// Each section owns a hue/sat/light ramp; its categories sweep it alphabetically
// to derive their swatch. This is the palette source, not a render.
const SECTION_RAMPS: Record<CategorySection, { hue: [number, number]; sat: [number, number]; light: [number, number] }> = {
  Code: { hue: [195, 182], sat: [55, 42], light: [34, 60] },
  Grow: { hue: [138, 108], sat: [34, 44], light: [32, 54] },
  Create: { hue: [18, -10], sat: [54, 50], light: [56, 64] },
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** A category's computed color (hue/sat/light) + its section. The single source
 *  for the palette — web `categories.ts` consumes this instead of recomputing. */
export type Swatch = { hue: number; sat: number; light: number; section: CategorySection }
export const CATEGORY_SWATCHES: Record<CategoryKey, Swatch> = (() => {
  const out = {} as Record<CategoryKey, Swatch>
  for (const section of CATEGORY_SECTIONS) {
    const members = CATEGORY_DEFS.filter((c) => c.section === section).sort((a, b) =>
      a.label.localeCompare(b.label),
    )
    const ramp = SECTION_RAMPS[section]
    members.forEach((c, i) => {
      const t = members.length > 1 ? i / (members.length - 1) : 0
      out[c.key] = {
        section,
        hue: Math.round(((lerp(ramp.hue[0], ramp.hue[1], t) % 360) + 360) % 360),
        sat: Math.round(lerp(ramp.sat[0], ramp.sat[1], t)),
        light: Math.round(lerp(ramp.light[0], ramp.light[1], t)),
      }
    })
  }
  return out
})()

const KEYS = Object.keys(CATEGORY_SWATCHES) as CategoryKey[]

// FNV-1a — matches the web engine so a seed maps to the same fallback category.
export function fnv(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0
  return h >>> 0
}

/** The deterministic fallback category for a seed (when real categories are absent).
 *  Callers without category data (e.g. kit covers, which need one per member to
 *  seed the painted cover) can build `members.map(seedCategory)`. */
export function seedCategory(seed: string): CategoryKey {
  return KEYS[fnv(seed) % KEYS.length]
}

/** Valid categories, with a deterministic seed fallback so a cover is never blank. */
function resolveCats(categories: (string | null | undefined)[], seed: string): CategoryKey[] {
  const valid = categories.filter((c): c is CategoryKey => !!c && c in CATEGORY_SWATCHES)
  if (valid.length > 0) return valid
  return [KEYS[fnv(seed) % KEYS.length]]
}

/** The neutral hue for a genuinely-uncategorized single skill — a warm gray that
 *  reads as "no category" rather than borrowing a real category's tint. Shared so
 *  the hero wash behind the cover can match it. */
export const UNCATEGORIZED_HUE = 40

/** True for a single skill with no valid category — the case that renders a
 *  neutral ground-only cover instead of a seed-fabricated category shape. A kit
 *  (more than one member) keeps its decorative seed fallback, so this is false
 *  for multi-member input. */
export function isUncategorizedSingle(categories: (string | null | undefined)[]): boolean {
  if (categories.length > 1) return false
  return !categories.some((c) => !!c && c in CATEGORY_SWATCHES)
}

// ── Category glyph covers (the app-icon cover for a single categorized skill) ────
//
// A category-hue squircle in a soft gradient with the category glyph centered in
// the deep category color. Ported from the web's CategoryCover + category-icons so
// web and desktop render the SAME cover from ONE source. Each glyph is stored as an
// inner-SVG FRAGMENT (not a single path): many mix stroked <path> with FILLED
// <circle>/<rect>/<ellipse> primitives, so a single collapsed `d` would drop the
// dots/play-triangle. The renderer wraps the fragment in a <g> that sets the default
// stroke + `color` (which the fragment's fill="currentColor" resolves against).

/** Apple-style squircle (superellipse, n=4) filling the 120 viewBox, precomputed
 *  once. This is the single source for the cover silhouette — web's CategoryCover
 *  consumes categoryCoverSvg rather than recomputing its own squircle. */
const SQUIRCLE = ((cx: number, cy: number, half: number, n = 4, steps = 64): string => {
  let d = ''
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2
    const ct = Math.cos(t)
    const st = Math.sin(t)
    const x = cx + half * Math.sign(ct) * Math.abs(ct) ** (2 / n)
    const y = cy + half * Math.sign(st) * Math.abs(st) ** (2 / n)
    d += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2) + ' '
  }
  return d + 'Z'
})(60, 60, 60)

/** Per-category glyph, keyed by CategoryKey — the inner-SVG markup on a 16-unit
 *  viewBox (each primitive keeps its own fill/stroke). This is the CANONICAL glyph
 *  geometry: both the cover renderer here and web's CategoryIcon consume it, so the
 *  desktop tray and web never drift. Edit the marks here, not in web. */
export const CATEGORY_GLYPHS: Record<CategoryKey, string> = {
  frontend:
    '<rect x="1.75" y="3" width="12.5" height="10" rx="1.75"/><path d="M1.75 6.25h12.5"/><circle cx="4" cy="4.6" r="0.5" fill="currentColor" stroke="none"/><circle cx="5.9" cy="4.6" r="0.5" fill="currentColor" stroke="none"/>',
  mobile:
    '<rect x="4.25" y="1.75" width="7.5" height="12.5" rx="1.75"/><path d="M6.75 12.25h2.5"/>',
  backend:
    '<rect x="2.25" y="2.75" width="11.5" height="4.25" rx="1.25"/><rect x="2.25" y="9" width="11.5" height="4.25" rx="1.25"/><circle cx="4.75" cy="4.85" r="0.55" fill="currentColor" stroke="none"/><circle cx="4.75" cy="11.1" r="0.55" fill="currentColor" stroke="none"/>',
  database:
    '<ellipse cx="8" cy="3.75" rx="5" ry="2"/><path d="M3 3.75v8.5c0 1.1 2.24 2 5 2s5-.9 5-2v-8.5"/><path d="M3 8c0 1.1 2.24 2 5 2s5-.9 5-2"/>',
  devops:
    '<path d="M12.5 6.75A5 5 0 0 0 3.6 5"/><path d="M12.75 3.25v3.5h-3.5"/><path d="M3.5 9.25a5 5 0 0 0 8.9 1.75"/><path d="M3.25 12.75v-3.5h3.5"/>',
  security:
    '<path d="M8 1.75 2.75 4v3.6c0 3.3 2.3 5.35 5.25 6.65C10.95 12.95 13.25 10.9 13.25 7.6V4z"/><path d="M5.85 7.9 7.4 9.45 10.4 6"/>',
  quality:
    '<path d="M5.25 4 2 8l3.25 4"/><path d="M10.75 4 14 8l-3.25 4"/><path d="M6.9 8.4 7.9 9.4 10 6.6"/>',
  agents:
    '<path d="M8 1.75c.35 2.9 1.6 4.15 4.5 4.5-2.9.35-4.15 1.6-4.5 4.5-.35-2.9-1.6-4.15-4.5-4.5 2.9-.35 4.15-1.6 4.5-4.5Z"/><path d="M12.25 10.25c.15 1.2.65 1.7 1.85 1.85-1.2.15-1.7.65-1.85 1.85-.15-1.2-.65-1.7-1.85-1.85 1.2-.15 1.7-.65 1.85-1.85Z"/>',
  design:
    '<path d="M8 1.9a6.1 6.1 0 1 0 0 12.2c.95 0 1.5-.75 1.5-1.5 0-.95-.75-1.15-.75-2 0-.65.55-1.15 1.25-1.15h1.35a3.35 3.35 0 0 0 3.35-3.35C14.15 4.35 11.4 1.9 8 1.9Z"/><circle cx="5.2" cy="6" r="0.7" fill="currentColor" stroke="none"/><circle cx="8" cy="4.9" r="0.7" fill="currentColor" stroke="none"/><circle cx="10.7" cy="6.2" r="0.7" fill="currentColor" stroke="none"/><circle cx="4.8" cy="9.1" r="0.7" fill="currentColor" stroke="none"/>',
  product:
    '<path d="M4 2v12"/><path d="M4 2.75h7.5L9.75 5.25 11.5 7.75H4z"/>',
  research:
    '<path d="M6.25 1.75h3.5"/><path d="M6.75 2v4.4L3.3 11.6a1.4 1.4 0 0 0 1.18 2.15h7.04a1.4 1.4 0 0 0 1.18-2.15L9.25 6.4V2"/><path d="M5.15 9.5h5.7"/>',
  writing: '<path d="M3 3.75h10M3 6.75h10M3 9.75h10M3 12.75h6.5"/>',
  marketing:
    '<path d="M2.5 6.5 10.5 3v10L2.5 9.5z"/><path d="M2.5 6.5H2a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h.5"/><path d="M4.5 10v2.25a1.25 1.25 0 0 0 2.5 0v-1.15"/><path d="M12.75 6.25a2.5 2.5 0 0 1 0 3.5"/>',
  sales:
    '<path d="M2.25 10.75 6 6.75l2.5 2.5L13.5 4"/><path d="M10.25 4h3.25v3.25"/>',
  finance:
    '<rect x="1.75" y="4" width="12.5" height="8" rx="1.5"/><circle cx="8" cy="8" r="1.9"/><path d="M4.25 8h.01M11.75 8h.01"/>',
  productivity:
    '<path d="M2.25 4.4 3.5 5.65 5.75 3.25"/><path d="M2.25 11.4 3.5 12.65 5.75 10.25"/><path d="M8 4.5h5.75M8 11.5h5.75"/>',
  media:
    '<rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25"/><path d="M6.5 5.75 10.75 8 6.5 10.25z" fill="currentColor"/>',
}

export interface CategoryCoverOptions {
  dark?: boolean
  /** Squircle ground only, no glyph — e.g. behind an avatar. */
  groundOnly?: boolean
}

/** The single-skill app-icon cover: a category-hue squircle gradient + the category
 *  glyph. `dark` swaps to a dark gradient + higher-contrast glyph (the web cover is
 *  light-only; dark is net-new here). Glyph scales the 16-unit source into the 120
 *  viewBox at ~42% (translate 34.8, scale 3.15), stroke-width 1.35 matching the web
 *  cover so the stroke stays a hairline at tray sizes. */
export function categoryCoverSvg(category: CategoryKey, opts: CategoryCoverOptions = {}): string {
  const dark = opts.dark ?? false
  const c = CATEGORY_SWATCHES[category]
  const gid = `cc-${category}${dark ? '-d' : ''}`
  const gradTop = dark ? `hsl(${c.hue} 30% 27%)` : `hsl(${c.hue} 44% 88%)`
  const gradBot = dark ? `hsl(${c.hue} 26% 21%)` : `hsl(${c.hue} 40% 80%)`
  const glyphCol = dark ? `hsl(${c.hue} ${c.sat}% 70%)` : `hsl(${c.hue} ${c.sat}% 38%)`
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">`
  const glyph = opts.groundOnly
    ? ''
    : `<g transform="translate(34.8 34.8) scale(3.15)" fill="none" stroke="${glyphCol}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" style="color:${glyphCol}">${CATEGORY_GLYPHS[category]}</g>`
  return `${open}<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${gradTop}"/><stop offset="100%" stop-color="${gradBot}"/></linearGradient></defs><path d="${SQUIRCLE}" fill="url(#${gid})"/>${glyph}</svg>`
}

export interface CoverOptions {
  dark?: boolean
  /** Render only the tinted ground, no glyph (e.g. behind an avatar). */
  groundOnly?: boolean
  /** List/thumbnail size: show a neutral placeholder mark when uncategorized. */
  listMark?: boolean
}

/** Muted mark for uncategorized singles at list sizes — not a category shape.
 *  A dashed outline, not a filled one: it reads as "cover not decided yet".
 *  The category (and so the section shape) isn't chosen, so the mark slowly
 *  cross-fades through all three shapes in the cover vocabulary — Grow △,
 *  Create ○, Code □ — one every few seconds, with a gentle dash drift. Quiet
 *  and undecided rather than static. `prefers-reduced-motion` freezes it on the
 *  triangle (the shapes default to triangle-visible, animation only overrides).
 *
 *  Rendered as one inline <style> + three dashed shapes. The engine's output is
 *  injected via dangerouslySetInnerHTML on every surface, so the rules apply
 *  document-wide; class names are prefixed to avoid collisions and identical
 *  blocks across instances simply dedupe and animate in sync. */
function uncategorizedListMark(dark: boolean): string {
  const stroke = dark ? `hsl(${UNCATEGORIZED_HUE} 8% 62%)` : `hsl(${UNCATEGORIZED_HUE} 12% 45%)`
  const common = `fill="none" stroke="${stroke}" stroke-width="3.5" stroke-dasharray="7 5" stroke-linecap="round" stroke-linejoin="round"`
  const style = `<style>
@keyframes skc-uncat-t{0%,30%{opacity:1}36%,96%{opacity:0}100%{opacity:1}}
@keyframes skc-uncat-c{0%,30%{opacity:0}36%,63%{opacity:1}69%,100%{opacity:0}}
@keyframes skc-uncat-s{0%,63%{opacity:0}69%,96%{opacity:1}100%{opacity:0}}
@keyframes skc-uncat-drift{to{stroke-dashoffset:-12}}
.skc-uncat-t{animation:skc-uncat-drift 5s linear infinite,skc-uncat-t 12s ease-in-out infinite}
.skc-uncat-c{animation:skc-uncat-drift 5s linear infinite,skc-uncat-c 12s ease-in-out infinite}
.skc-uncat-s{animation:skc-uncat-drift 5s linear infinite,skc-uncat-s 12s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.skc-uncat>*{animation:none}.skc-uncat-c,.skc-uncat-s{opacity:0}}
</style>`
  const tri = `<path class="skc-uncat-t" d="M60 40 L81.5 77 L38.5 77 Z" opacity="1" ${common}/>`
  const cir = `<circle class="skc-uncat-c" cx="60" cy="61" r="20.5" opacity="0" ${common}/>`
  const sq = `<rect class="skc-uncat-s" x="41.5" y="41.5" width="37" height="37" rx="5" opacity="0" ${common}/>`
  return `${style}<g class="skc-uncat">${tri}${cir}${sq}</g>`
}

/**
 * The cover SVG for a skill or kit. `categories` is a single [key] for a skill
 * or the members' keys for a kit; pass `[]` to let the seed pick a fallback.
 */
export function coverSvg(
  seed: string,
  categories: (string | null | undefined)[] = [],
  opts: CoverOptions = {},
): string {
  const dark = opts.dark ?? false
  const cats = resolveCats(categories, seed)
  const open = `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 120 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true">`

  // A genuinely-uncategorized single skill: neutral warm ground, NO shape (a
  // section shape would encode a category the skill doesn't have). Tuned to the
  // app's warm neutral (matches --accent-bg / --line) so the placeholder reads as
  // deliberately part of the palette, not a cool gray sitting against warm chrome.
  if (isUncategorizedSingle(categories)) {
    const ground = dark ? `hsl(${UNCATEGORIZED_HUE} 12% 15%)` : `hsl(${UNCATEGORIZED_HUE} 22% 89%)`
    const mark = opts.listMark ? uncategorizedListMark(dark) : ''
    return `${open}<rect x="-1" y="-1" width="122" height="122" fill="${ground}"/>${mark}</svg>`
  }

  // A single categorized skill: the app-icon cover — category-hue squircle gradient
  // + the category glyph (shared with web via categoryCoverSvg). `resolveCats`
  // guarantees cats[0] is a valid CategoryKey here (a present-but-invalid category
  // takes the isUncategorizedSingle branch above).
  if (cats.length === 1) {
    return categoryCoverSvg(cats[0], { dark, groundOnly: opts.groundOnly })
  }

  // A kit: a flat ground in the dominant category hue. The visible kit cover is
  // the painted canvas print; this instant SVG is only the pre-hydration underlay
  // or the hidden ground behind an avatar, so it matches the painted cover's flat
  // fallback tint (see the web PaintedCover) rather than drawing its own art.
  const counts = new Map<CategoryKey, number>()
  for (const k of cats) counts.set(k, (counts.get(k) ?? 0) + 1)
  const domKey =
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? cats[0]
  const dom = CATEGORY_SWATCHES[domKey]
  const ground = dark ? `hsl(${dom.hue} 10% 12%)` : `hsl(${dom.hue} 16% 86%)`
  return `${open}<rect x="-1" y="-1" width="122" height="122" fill="${ground}"/></svg>`
}
