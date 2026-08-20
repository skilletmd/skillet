/**
 * Desktop cover painting — the tray's consumer of the SHARED canvas cover
 * engine in @skillet/protocol/cover-canvas, so tray tiles paint the exact
 * system the web ships (monochrome skill rolls, category-wave kits,
 * knocked-out glyphs/marks, dark pressings).
 *
 * The tray renders lists as innerHTML strings, so covers hydrate lazily: the
 * cover string carries `data-cover` attributes over the instant SVG layer,
 * and a MutationObserver installed once at boot paints a canvas into every
 * unpainted cover after each render. Theme flips invalidate and repaint.
 */

import {
  DEFAULT_GRAIN,
  PRESS_SEED,
  SOLO_MARK_MAX,
  glyphMask,
  glyphOptics,
  isCoverCategory,
  printPx,
  kitMarkMask,
  kitRecipe,
  renderRecipe,
  skillRecipe,
} from '@skillet/protocol/cover-canvas'

function isDark(): boolean {
  const el = document.documentElement
  if (el.classList.contains('preview-dark')) return true
  if (el.classList.contains('preview-light')) return false
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

/** The data attributes a cover span carries for hydration. `cats` is a
 *  comma-joined CategoryKey list — one for a skill, the members' for a kit. */
export function coverPaintAttrs(seed: string, cats: (string | null | undefined)[]): string {
  const valid = cats.filter(isCoverCategory)
  if (valid.length === 0) return ''
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return ` data-cover-seed="${esc(seed)}" data-cover-cats="${esc(valid.join(','))}"`
}

async function paint(el: HTMLElement, dark: boolean): Promise<void> {
  const seed = el.dataset.coverSeed
  const cats = (el.dataset.coverCats ?? '').split(',').filter(isCoverCategory)
  if (!seed || cats.length === 0) return
  const size = Math.max(el.offsetWidth, el.offsetHeight)
  if (size === 0) return
  const isKit = cats.length > 1
  const grain = { ...DEFAULT_GRAIN, dark }
  const recipe = isKit
    ? kitRecipe(seed, cats, PRESS_SEED, grain)
    : skillRecipe(cats[0], PRESS_SEED, grain, 'system', seed)
  const px = printPx(size, window.devicePixelRatio || 1)
  const optics = glyphOptics(size)
  const mask = isKit
    ? await kitMarkMask(cats, px, size < SOLO_MARK_MAX)
    : await glyphMask(cats[0], px, optics.frac, optics.stroke)
  // The element may have re-rendered while the mask rasterized.
  if (!el.isConnected) return
  let canvas = el.querySelector<HTMLCanvasElement>('canvas.cover-canvas')
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.className = 'cover-canvas'
    canvas.setAttribute('aria-hidden', 'true')
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:cover'
    const st = getComputedStyle(el)
    if (st.position === 'static') el.style.position = 'relative'
    el.appendChild(canvas)
  }
  // Burn glyph: same-hue overprint, matching the web covers (one vocabulary).
  renderRecipe(canvas, recipe, mask, false, px, 'burn')
  el.dataset.coverPainted = dark ? 'dark' : 'light'
}

function paintAll(): void {
  const want = isDark() ? 'dark' : 'light'
  document
    .querySelectorAll<HTMLElement>('[data-cover-seed]')
    .forEach((el) => {
      if (el.dataset.coverPainted !== want) void paint(el, want === 'dark')
    })
}

let installed = false
let scheduled = false

/** Install once at boot: paints covers after every render (innerHTML
 *  swaps) and repaints on theme changes. Idempotent. */
export function installCoverPainting(): void {
  if (installed) return
  installed = true
  const schedule = (): void => {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(() => {
      scheduled = false
      paintAll()
    })
  }
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true })
  // Theme: OS scheme changes and the preview-theme classes on <html>.
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', schedule)
  new MutationObserver(schedule).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  })
  schedule()
}
