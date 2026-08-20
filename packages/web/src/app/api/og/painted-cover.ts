import { deflateSync } from 'node:zlib'
import {
  DEFAULT_GRAIN,
  PRESS_SEED,
  glyphSvgGroup,
  glyphOptics,
  isCoverCategory,
  kitMarkSvgParts,
  kitRecipe,
  renderRecipePixels,
  skillRecipe,
} from '@skillet/protocol/cover-canvas'
import { seedCategory } from '@skillet/protocol/covers'
import type { CategoryKey } from '@/lib/categories'

/**
 * Server-side painted covers for OG cards: the SAME pixel engine the site and
 * desktop paint with, run into a raw RGBA buffer (renderRecipePixels is pure
 * math — the engine is only browser-bound at its canvas/mask edges, which OG
 * replaces with a minimal PNG encoder and SVG overlays). A share card's cover
 * is byte-identical to the page's print.
 */

// The engine's paper (hsl 42 42% 94%) as hex, for inking SVG overlays.
export const PAPER_HEX = '#f6f2e9'

// ── Minimal PNG encoder (truecolor 8-bit RGBA, no deps) ─────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

function encodePng(rgba: Uint8ClampedArray, w: number, h: number): Buffer {
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type: RGBA
  // 10..12: compression/filter/interlace = 0
  // Scanlines with filter byte 0.
  const raw = new Uint8Array(h * (1 + w * 4))
  for (let y = 0; y < h; y++) {
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (1 + w * 4) + 1)
  }
  const idat = deflateSync(raw)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(idat)),
    chunk('IEND', new Uint8Array(0)),
  ])
}

// ── Cover + stage builders ───────────────────────────────────────────────────

function resolve(seed: string, cats: (string | null | undefined)[]): CategoryKey[] {
  const valid = cats.filter(isCoverCategory)
  return valid.length > 0 ? valid : [seedCategory(seed)]
}

/** The painted cover ground as a PNG data URI (square, `px` wide). */
export function paintedCoverPngUri(
  seed: string,
  cats: (string | null | undefined)[],
  px: number,
): string {
  const valid = resolve(seed, cats)
  const isKit = cats.length > 1 && valid.length > 1
  const recipe = isKit
    ? kitRecipe(seed, valid, PRESS_SEED, DEFAULT_GRAIN)
    : skillRecipe(valid[0], PRESS_SEED, DEFAULT_GRAIN, 'system', seed)
  const png = encodePng(renderRecipePixels(recipe, px), px, px)
  return `data:image/png;base64,${png.toString('base64')}`
}

/** The cover's printed mark layer (kit marks + edition stamp, or the skill
 *  glyph) as an SVG data URI sized to overlay the ground exactly. */
export function coverMarksSvgUri(
  seed: string,
  cats: (string | null | undefined)[],
  px: number,
  /** Visible width fraction under the stage's horizontal center-crop. */
  visibleWFrac = 1,
): string {
  const valid = resolve(seed, cats)
  const isKit = cats.length > 1 && valid.length > 1
  const body = isKit
    ? kitMarkSvgParts(valid, px, false, 1, PAPER_HEX, visibleWFrac).parts
    : glyphSvgGroup(valid[0], px, glyphOptics(px).frac, glyphOptics(px).stroke, PAPER_HEX)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">${body}</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

/** Brand pages stage on painted rolls in SYSTEM hues (the old spotlight
 *  gradients ran arbitrary blues/purples). Each page type prints a stable
 *  category's roll; home pins the brand teal via frontend. */
const BRAND_CATEGORY: Record<string, CategoryKey> = {
  home: 'frontend',
  docs: 'backend',
  install: 'devops',
  blog: 'writing',
  feed: 'marketing',
  browse: 'productivity',
  generic: 'frontend',
}

export function brandCategory(variant: string): CategoryKey {
  return BRAND_CATEGORY[variant] ?? BRAND_CATEGORY.generic
}

/** The brand stage as a painted skill roll, seeded per page type. */
export function brandStagePngUri(variant: string, px: number): string {
  const key = brandCategory(variant)
  const recipe = skillRecipe(key, PRESS_SEED, DEFAULT_GRAIN, 'system', `og-stage/${variant}`)
  const png = encodePng(renderRecipePixels(recipe, px), px, px)
  return `data:image/png;base64,${png.toString('base64')}`
}
