/**
 * The canvas cover engine: per-pixel generative skill/kit cover art, shared
 * by web and desktop so the two surfaces can never drift (same contract as
 * the SVG engine in ./covers, which stays the instant/SSR/OG layer beneath
 * these). Designed in the web's /lab/cover-experiments — see that page for
 * the full rationale and every rejected alternative. The system:
 *   - Every skill cover is a monochrome gradation roll of its category ink
 *     (deep -> mid -> light -> paper); the skill's ref seeds the pressing
 *     (roll direction, shade anchors, screen cell).
 *   - Kits are the only multicolor covers: one wave per member category,
 *     thickness proportional to member share, plus weighted section marks
 *     (square Code / circle Create / triangle Grow), solo below 56px.
 *   - One screen by default: fine Bayer 8x8 dither at pixel size 1.
 *   - Glyphs and marks are knocked out INTO the raster, not overlaid.
 *
 * Browser-only (canvas + Image): import from webview/browser code paths
 * ONLY, never from node (CLI/registry) code. The SVG engine in ./covers
 * remains the instant/SSR/OG layer beneath these prints.
 */

import {
  CATEGORY_GLYPHS,
  CATEGORY_SWATCHES,
  fnv,
  type CategoryKey,
  type CategorySection,
  type Swatch,
} from './covers.js'

/** Valid category key guard, shared by every cover consumer. */
export function isCoverCategory(c: string | null | undefined): c is CategoryKey {
  return !!c && c in CATEGORY_SWATCHES
}

// ── Noise (verbatim from the texture.ai.studio bundle) ──────────────────────

function hash2(x: number, y: number, seed: number): number {
  let i = seed + x * 374761393 + y * 668265263
  i = (i ^ (i >> 13)) * 1274126177
  i ^= i >> 16
  return (i & 2147483647) / 2147483647
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash2(xi, yi, seed)
  const b = hash2(xi + 1, yi, seed)
  const c = hash2(xi, yi + 1, seed)
  const d = hash2(xi + 1, yi + 1, seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

function fbm(x: number, y: number, seed: number, octaves = 3): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 1000)
    amp *= 0.5
    freq *= 2
  }
  return sum
}

// ── Screens: how a boundary dithers ──────────────────────────────────────────
//
// 'grain' is the riso spray (white noise). The Bayer screens are the ordered
// dither from paxel.ycombinator.com's tool: a repeating threshold matrix, so
// transitions render as a crisp pixel pattern instead of noise. 'hatch' is a
// line screen (banknote engraving): transitions render as fine parallel lines
// thickening toward the ink. Pixel size chunks the sampling like paxel's
// Pixel size slider (and scales the hatch period).

export type Screen = 'grain' | 'bayer2' | 'bayer4' | 'bayer8' | 'hatch' | 'dots'

const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
]
const BAYER2 = [
  [0, 2],
  [3, 1],
]
// 8×8 derived from the 4×4 by the standard recurrence.
const BAYER8 = Array.from({ length: 8 }, (_, y) =>
  Array.from({ length: 8 }, (_, x) => BAYER4[y % 4][x % 4] * 4 + BAYER2[Math.floor(y / 4)][Math.floor(x / 4)]),
)

/** Threshold in [0,1) at (x,y) for the given screen. `wn` is the white-noise
 *  fallback so grain mode costs nothing extra. */
function screenThreshold(screen: Screen, x: number, y: number, pixelSize: number, wn: number): number {
  if (screen === 'grain') return wn
  if (screen === 'hatch') {
    // Steep engraved lines, guilloché-adjacent. The threshold ramps across
    // each line period, so a boundary renders as lines thickening into the
    // next ink.
    const period = 2 * pixelSize + 1
    const proj = x * 0.4695 + y * 0.8829 // 62° line angle
    const f = proj / period - Math.floor(proj / period)
    return f
  }
  if (screen === 'dots') {
    // AM halftone: round dots on a 45° grid (the offset-press screen —
    // newsprint, stock pages, printed money). Low threshold at cell centers,
    // so a boundary renders as dots growing into the next ink.
    const cell = 2.5 * pixelSize + 2
    const c = Math.SQRT1_2
    const u = (x * c + y * c) / cell
    const v = (-x * c + y * c) / cell
    const fu = u - Math.round(u)
    const fv = v - Math.round(v)
    return Math.min(1, Math.hypot(fu, fv) / 0.7071)
  }
  const xx = Math.floor(x / pixelSize)
  const yy = Math.floor(y / pixelSize)
  if (screen === 'bayer2') return (BAYER2[yy % 2][xx % 2] + 0.5) / 4
  if (screen === 'bayer8') return (BAYER8[yy % 8][xx % 8] + 0.5) / 64
  return (BAYER4[yy % 4][xx % 4] + 0.5) / 16
}

/** Section-owned screens: three reproduction technologies. Code is the
 *  digital raster (Bayer pixels), Grow is the offset-press halftone dot
 *  screen (newsprint, stock pages), Create is the riso stencil (grain).
 *  Hatch was tried for Grow and cut (scratchy, shredded glyphs). */
const SECTION_SCREEN: Record<CategorySection, Screen> = {
  // 8×8 at pixel size 2: finer pixels but a larger ordered pattern, so the
  // raster reads structured-digital without going blocky (3px was too
  // pixely, 4×4 at 2px too close to grain).
  Code: 'bayer8',
  Grow: 'dots',
  Create: 'grain',
}

/** Per-section pixel scale in section mode. The slider still rules when a
 *  screen is forced. */
const SECTION_PIXEL: Record<CategorySection, number> = {
  Code: 2,
  Grow: 2,
  Create: 2,
}

export type ScreenMode = Screen | 'section'

// ── Inks: category swatch → limited riso drum set ───────────────────────────

type RGB = [number, number, number]

function hslToRgb(h: number, s: number, l: number): RGB {
  const sn = s / 100
  const ln = l / 100
  const k = (n: number): number => (n + h / 30) % 12
  const a = sn * Math.min(ln, 1 - ln)
  const f = (n: number): number =>
    ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)]
}

const PAPER: RGB = hslToRgb(42, 42, 94)

/** The dark-mode sheet: warm near-black, DARKER than the app's dark card
 *  surfaces so the un-inked region reads as printed sheet, not a missing
 *  corner blending into the page. */
const PAPER_DARK: RGB = hslToRgb(40, 8, 8)

const paperFor = (dark: boolean): RGB => (dark ? PAPER_DARK : PAPER)

/** The sheet as it appears INSIDE a roll — the gradient's terminal band. Raw
 *  paper there read as a blown corner (near-white in light mode, dissolving
 *  into the panel in dark), so the roll ends on a hue-tinted sheet that never
 *  reaches full white/black. The true paper stays the knockout/sheet color. */
const rollSheet = (hue: number, dark: boolean): RGB =>
  dark ? hslToRgb(hue, 18, 26) : hslToRgb(hue, 30, 87)

/** The authored accent drum, one per section. Not a hash choice: Code pairs
 *  with a riso orange, Grow with a riso pink, Create carries no accent (its
 *  reds are loud enough alone). Saturation held below the category inks so
 *  the accent seasons, never shouts. */
const SECTION_ACCENT: Record<CategorySection, RGB> = {
  Code: hslToRgb(28, 64, 56),
  Grow: hslToRgb(330, 62, 58),
  Create: hslToRgb(185, 40, 52),
}

interface Inks {
  deep: RGB
  mid: RGB
  light: RGB
  accent: RGB
}

function categoryInks(cat: Swatch, dark = false): Inks {
  if (dark) {
    // Inks for the dark sheet: same hue story, lifted off the near-black
    // paper without going neon.
    return {
      deep: hslToRgb(cat.hue, Math.min(cat.sat + 16, 88), 30),
      mid: hslToRgb(cat.hue, cat.sat, 44),
      light: hslToRgb(cat.hue, Math.round(cat.sat * 0.9), 56),
      accent: SECTION_ACCENT[cat.section],
    }
  }
  return {
    deep: hslToRgb(cat.hue, Math.min(cat.sat + 24, 92), 24),
    mid: hslToRgb(cat.hue, Math.min(cat.sat + 8, 88), 46),
    light: hslToRgb(cat.hue, Math.round(cat.sat * 0.85), 76),
    accent: SECTION_ACCENT[cat.section],
  }
}

const inkList = (i: Inks, paper: RGB): RGB[] => [i.deep, i.mid, i.light, i.accent, paper]

// ── Recipes: identity → print parameters ────────────────────────────────────

export type CoverStyle = 'gradation' | 'halftone' | 'overprint'

export const STYLES: CoverStyle[] = ['gradation', 'halftone', 'overprint']

/** Kit rule: the members' dominant section picks the kit composition. Code
 *  kits keep the overprint arc (one circle per member). */
export const SECTION_STYLE: Record<CategorySection, CoverStyle> = {
  Code: 'overprint',
  Grow: 'gradation',
  Create: 'halftone',
}

/** Skill rule: every cover is a grain roll. The system reduced to one form
 *  after every other composition was tried and cut (overprint shapes read as
 *  distracting, hatch shredded the glyphs, the dome lost to the roll). A
 *  section is its hue plus its roll direction. Halftone and overprint survive
 *  in the style select and in kit prints. */
const SKILL_SECTION_STYLE: Record<CategorySection, CoverStyle> = {
  Code: 'gradation',
  Grow: 'gradation',
  Create: 'gradation',
}

/** Roll directions belong to the PRESSING, not the section: hue already says
 *  the section, so locking direction to it was dead redundancy. The pool
 *  spans rising through both diagonals (paper always ends up high) and each
 *  ref hashes its own pick. */
const GRAD_ANGLES = [
  Math.PI * 0.22,
  Math.PI * 0.28,
  Math.PI * 0.34,
  Math.PI * 0.42,
  Math.PI * 0.5,
  Math.PI * 0.58,
  Math.PI * 0.66,
  Math.PI * 0.72,
  Math.PI * 0.78,
]

export type StyleMode = CoverStyle | 'system'

/** One overprint pass in unit coordinates. `dome` is a circle pinned to an
 *  edge; the kind is kept for the derivation note. A bar's `r` is its angle. */
interface OverShape {
  kind: 'circle' | 'dome' | 'bar' | 'ring'
  x: number
  y: number
  r: number
  w: number
}

/** The overprint grammar: exactly three slots. An anchor dome bleeding off one
 *  edge (deep ink, the mass), a mid pass (bar or opposite dome, mid ink), and
 *  one small interior accent (dot or ring, the ONLY place the accent drum may
 *  print). The hash picks edges, angles, and phase; never count or scale
 *  class. */
function overComposition(h: number): OverShape[] {
  // Anchor: dome off one of the four edges.
  const e = Math.floor(hash2(30, 1, h) * 4)
  const t = 0.25 + hash2(30, 2, h) * 0.5
  const anchor: OverShape = {
    kind: 'dome',
    x: e === 2 ? -0.04 : e === 3 ? 1.04 : t,
    y: e === 0 ? 1.04 : e === 1 ? -0.04 : t,
    r: 0.55 + hash2(30, 3, h) * 0.16,
    w: 0,
  }
  // Mid: a bar through the opposite half, or a smaller dome on the opposite edge.
  let mid: OverShape
  if (hash2(31, 1, h) > 0.45) {
    const barY = anchor.y > 0.5 ? 0.16 + hash2(31, 2, h) * 0.18 : 0.66 + hash2(31, 2, h) * 0.18
    mid = {
      kind: 'bar',
      x: 0.5,
      y: barY,
      r: [Math.PI * 0.18, Math.PI * 0.3, Math.PI * 0.7, Math.PI * 0.82][
        Math.floor(hash2(31, 3, h) * 4)
      ],
      w: 0.14 + hash2(31, 4, h) * 0.05,
    }
  } else {
    const oe = e ^ 1
    const t2 = 0.25 + hash2(31, 2, h) * 0.5
    mid = {
      kind: 'dome',
      x: oe === 2 ? -0.04 : oe === 3 ? 1.04 : t2,
      y: oe === 0 ? 1.04 : oe === 1 ? -0.04 : t2,
      r: 0.32 + hash2(31, 3, h) * 0.1,
      w: 0,
    }
  }
  // Accent: small, interior, in the quadrant the anchor left open.
  const qx = anchor.x < 0.5 ? 0.72 : 0.28
  const qy = anchor.y < 0.5 ? 0.74 : 0.26
  const ax = qx + (hash2(32, 2, h) - 0.5) * 0.12
  const ay = qy + (hash2(32, 3, h) - 0.5) * 0.12
  const accent: OverShape =
    hash2(32, 1, h) > 0.6
      ? { kind: 'ring', x: ax, y: ay, r: 0.11 + hash2(32, 4, h) * 0.04, w: 0.035 }
      : { kind: 'circle', x: ax, y: ay, r: 0.1 + hash2(32, 4, h) * 0.05, w: 0 }
  return [anchor, mid, accent]
}

export interface Recipe {
  style: CoverStyle
  seed: number
  /** The sheet this pressing prints on (light paper or the dark variant). */
  paper: RGB
  inks: RGB[]
  grainIntensity: number
  grainScale: number
  screen: Screen
  pixelSize: number
  /** The pressing's drum drift, shared by every cover this seed (one print
   *  run), in cover-size fractions. */
  driftX: number
  driftY: number
  /** Human-readable derivation, shown under the card. */
  note: string
  // gradation
  gradAngle: number
  gradStops: RGB[]
  /** Cumulative end position of each stop (0..1 from the bottom of the roll).
   *  Lets the accent stop be a thin band instead of an equal share. Uniform
   *  when absent. */
  gradBounds?: number[]
  /** Kit rolls: discrete member bands instead of a smooth crossfade. */
  gradDiscrete?: boolean
  /** Seam width of the boundary crossfade in roll space. Kits narrow it so
   *  thin member bands keep solid cores while flowing like the skill rolls. */
  gradSeam?: number
  // halftone
  rings: RGB[]
  dotCell: number
  // overprint
  overShapes: OverShape[]
  overInks: RGB[]
  /** Kit overprints: one circle per member on an arc, max two passes. */
  overArc?: boolean
}

export interface GrainOpts {
  grainIntensity: number
  grainScale: number
  screen: ScreenMode
  pixelSize: number
  /** Print the dark pressing: dark sheet, re-laddered inks, dark knockout. */
  dark?: boolean
}

/** One misregistration vector per pressing (global seed), quantized to four
 *  directions. Every cover in a run drifts the same way. */
function pressDrift(globalSeed: number): { x: number; y: number } {
  const a = [Math.PI * 0.15, Math.PI * 0.35, Math.PI * 0.65, Math.PI * 0.85][globalSeed % 4]
  return { x: Math.cos(a) * 0.026, y: Math.sin(a) * 0.026 }
}

export function skillRecipe(
  catKey: CategoryKey,
  globalSeed: number,
  grain: GrainOpts,
  mode: StyleMode,
  /** The skill's own identity (ref). In production every skill seeds its own
   *  pressing (roll direction, shade anchors, screen cell); the category grid
   *  below omits it, so those covers represent the category, not one skill.
   *  (Complexity-driven step counts were tried and cut: too busy, and the
   *  single-file majority drew the worst variant.) */
  ref?: string,
): Recipe {
  const cat = CATEGORY_SWATCHES[catKey]
  const h = ref ? fnv(ref) : fnv(catKey)
  const seed = (h + globalSeed * 7919) >>> 0
  const style = mode === 'system' ? SKILL_SECTION_STYLE[cat.section] : mode
  const screen = grain.screen === 'section' ? SECTION_SCREEN[cat.section] : grain.screen
  const pixelSize = grain.screen === 'section' ? SECTION_PIXEL[cat.section] : grain.pixelSize
  const dark = grain.dark ?? false
  const paper = paperFor(dark)
  const ink = categoryInks(cat, dark)
  const drift = pressDrift(globalSeed)
  const shapes = overComposition(h)
  // Skills are strictly MONOCHROME: one ink laddered deep → paper.
  // Multicolor is reserved for kits, so color count reads as content count.
  // The ref drifts the shade anchors a little, so two same-category skills
  // print slightly different pulls of the same ink. The dark pressing lifts
  // the same ladder off the near-black sheet.
  const steps = 3
  // Dark floor sits above the light one: the grain jitter only darkens, and
  // at list sizes a sub-30 L deep end reads as a black corner, not ink.
  const deepL = (dark ? 32 : 22) + ((h >>> 7) % 7)
  // The dark ladder gets its range from the TOP: the shadow floor is pinned
  // (see above), so highlights climb higher instead — a 52-cap read flat next
  // to the light pressing's 65-point sweep.
  const lightL = (dark ? 64 : 73) + ((h >>> 11) % 7)
  const lerp = (a: number, b: number, t: number): number => a + (b - a) * t
  const inkSteps = Array.from({ length: steps }, (_, i) => {
    const t = i / (steps - 1)
    return hslToRgb(
      cat.hue,
      Math.round(lerp(Math.min(cat.sat + (dark ? 16 : 24), 92), cat.sat * 0.85, t)),
      Math.round(lerp(deepL, lightL, t)),
    )
  })
  const gradStops = [...inkSteps, rollSheet(cat.hue, dark)]
  const gradBounds = [...inkSteps.map((_, i) => (0.86 * (i + 1)) / steps), 1]
  const dotCell = 9 + ((h >>> 6) % 4) * 2
  const noteBits: Record<CoverStyle, string> = {
    gradation: 'single-ink roll',
    halftone: `dome, ${dotCell}px screen`,
    overprint: shapes.map((s, i) => (i === 2 && s.kind === 'circle' ? 'dot' : s.kind)).join(' + '),
  }
  return {
    style,
    seed,
    paper,
    inks: inkList(ink, paper),
    grainIntensity: grain.grainIntensity,
    grainScale: grain.grainScale,
    screen,
    pixelSize,
    driftX: drift.x,
    driftY: drift.y,
    note: `${style} · ${noteBits[style]}`,
    gradAngle: GRAD_ANGLES[(h >>> 4) % GRAD_ANGLES.length],
    gradStops,
    // The accent stop is a thin band (~16% of the roll); the category ink and
    // paper own the rest of the canvas.
    gradBounds,
    rings: [ink.deep, ink.mid, ink.light, paper],
    dotCell,
    overShapes: shapes,
    overInks: [ink.deep, ink.mid, ink.accent],
  }
}

const luminance = (c: RGB): number => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]

/** The kit print comes from the skills inside. The members' dominant section
 *  picks the roll direction and the screen, and every member prints ONE
 *  COUNTABLE band in that member's mid ink. Skills are continuous rolls; a
 *  kit is the same roll stacked into discrete member bands. */
export function kitRecipe(name: string, members: CategoryKey[], globalSeed: number, grain: GrainOpts): Recipe {
  const h = fnv(name)
  const seed = (h + globalSeed * 7919) >>> 0
  const cats = members.map((k) => CATEGORY_SWATCHES[k])
  const drift = pressDrift(globalSeed)
  const dark = grain.dark ?? false
  const paper = paperFor(dark)
  const first = categoryInks(cats[0], dark)

  const counts = new Map<CategorySection, number>()
  for (const c of cats) counts.set(c.section, (counts.get(c.section) ?? 0) + 1)
  const top = Math.max(...counts.values())
  const leaders = [...counts.entries()].filter(([, n]) => n === top).map(([s]) => s)
  const dominant = leaders[(h >>> 5) % leaders.length]
  const style: CoverStyle = 'gradation'
  const screen = grain.screen === 'section' ? SECTION_SCREEN[dominant] : grain.screen

  // One wave per CATEGORY, thickness proportional to how many members of it
  // the kit holds (three frontend skills print one fat teal wave, not three
  // clone bands). Lightness climbs a deliberate ladder across the waves so
  // same-hue categories still separate, spanning the same deep-to-light range
  // as the skill rolls. No accent seam: every ink on a kit IS a member
  // category. (Per-member equal bands and a fixed section accent were both
  // tried and cut.)
  const catCounts = new Map<CategoryKey, number>()
  for (const k of members) catCounts.set(k, (catCounts.get(k) ?? 0) + 1)
  const grouped = [...catCounts.entries()]
    .map(([k, count]) => ({ cat: CATEGORY_SWATCHES[k], count }))
    .sort((a, b) => luminance(categoryInks(a.cat).mid) - luminance(categoryInks(b.cat).mid))
  const n = Math.max(grouped.length - 1, 1)
  // Dark pressing: a tighter, lifted ladder off the near-black sheet.
  const ladderBase = dark ? 32 : 26
  const ladderSpan = dark ? 34 : 50
  const subSpread = dark ? 10 : 14
  const bandInks = grouped.map(({ cat: c }, i) =>
    hslToRgb(c.hue, Math.min(c.sat + 16, 92), Math.round(ladderBase + (i / n) * ladderSpan)),
  )
  // Category waves share the bottom 84% by member share, paper takes the rest.
  // Two guards for real-world kits (a 24-skill kit is not a sample kit):
  //   - a floor of 6% per wave, so a 1-of-24 category prints a visible band
  //     instead of a sliver that reads as an artifact;
  //   - a fat wave (>25% share) subdivides into 2-3 lightness steps of its own
  //     hue — a mini-roll inside the wave — so a dominant category prints rich
  //     instead of one flat slab.
  const shares = grouped.map(({ count }) => Math.max(count / members.length, 0.06))
  const shareTotal = shares.reduce((a, s) => a + s, 0)
  const gradStops: RGB[] = []
  const gradBounds: number[] = []
  let acc = 0
  grouped.forEach(({ cat: c }, i) => {
    const start = (acc / shareTotal) * 0.84
    acc += shares[i]
    const end = (acc / shareTotal) * 0.84
    const share = shares[i] / shareTotal
    const sub = share > 0.45 ? 3 : share > 0.25 ? 2 : 1
    const baseL = ladderBase + (i / n) * ladderSpan
    for (let j = 0; j < sub; j++) {
      const l = Math.max(dark ? 26 : 18, Math.min(80, baseL + (j - (sub - 1) / 2) * subSpread))
      gradStops.push(hslToRgb(c.hue, Math.min(c.sat + 16, 92), Math.round(l)))
      gradBounds.push(start + ((j + 1) / sub) * (end - start))
    }
  })
  // The terminal band tints toward the LIGHTEST wave's hue (the ladder ends
  // there), keeping the roll continuous instead of snapping to raw paper.
  gradStops.push(rollSheet(grouped[grouped.length - 1].cat.hue, dark))
  gradBounds.push(1)
  return {
    style,
    seed,
    paper,
    inks: inkList(first, paper),
    grainIntensity: grain.grainIntensity,
    grainScale: grain.grainScale,
    screen,
    pixelSize: grain.screen === 'section' ? SECTION_PIXEL[dominant] : grain.pixelSize,
    driftX: drift.x,
    driftY: drift.y,
    note: `mostly ${dominant} · waves sized by category share`,
    gradAngle: GRAD_ANGLES[(h >>> 4) % GRAD_ANGLES.length],
    gradStops,
    gradBounds,
    // Same feathered seam as the skill rolls, narrowed so thin bands keep a
    // solid core (the old discrete mode made kit bands abrupt).
    gradSeam: Math.min(0.1, (0.76 / Math.max(gradStops.length - 1, 2)) * 0.35),
    rings: bandInks,
    dotCell: 11,
    overShapes: [],
    overInks: bandInks,
    overArc: true,
  }
}

// ── Renderers ────────────────────────────────────────────────────────────────

const clamp255 = (n: number): number => Math.max(0, Math.min(255, n))

/** Semi-transparent soy ink over another color: multiply, slightly lifted so
 *  overlaps read as a third color instead of mud. */
function overIck(base: RGB, ink: RGB): RGB {
  return [
    (base[0] * (ink[0] + 40)) / 295,
    (base[1] * (ink[1] + 40)) / 295,
    (base[2] * (ink[2] + 40)) / 295,
  ]
}

/** Grain is dark-only: ink (and paper tooth) can never be brighter than the
 *  sheet. */
function grainJit(wn: number, intensity: number): number {
  return -wn * (4 + intensity * 18)
}

function writePixel(data: Uint8ClampedArray, o: number, col: RGB, jit: number): void {
  data[o] = clamp255(col[0] + jit)
  data[o + 1] = clamp255(col[1] + jit)
  data[o + 2] = clamp255(col[2] + jit)
  data[o + 3] = 255
}

/** The grain-dithered gradation roll. Skills crossfade stops continuously
 *  (Grain Touch); kit rolls are discrete, one hard-ish band per member. */
function renderGradation(data: Uint8ClampedArray, px: number, r: Recipe): void {
  const cos = Math.cos(r.gradAngle)
  const sin = Math.sin(r.gradAngle)
  const corners = [0, px * cos, px * sin, px * (cos + sin)]
  const lo = Math.min(...corners)
  const span = Math.max(...corners) - lo || 1
  const stops = r.gradStops
  const quantized = r.screen !== 'grain'
  // Bayer chunks the sampling to the pixel grid; hatch keeps smooth sampling
  // (the lines carry the structure) and grain keeps the spray.
  const chunk = r.screen === 'bayer2' || r.screen === 'bayer4' || r.screen === 'bayer8' ? r.pixelSize : 1
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const qx = Math.floor(x / chunk) * chunk
      const qy = Math.floor(y / chunk) * chunk
      let t = (qx * cos + qy * sin - lo) / span
      t += (fbm(qx / (r.grainScale * 1.8), qy / (r.grainScale * 1.8), r.seed + 333) - 0.5) * 0.22
      t = Math.max(0, Math.min(0.999, t))
      // The roll rises: deep ink at the bottom, paper at the top.
      t = 1 - t
      const raw = hash2(qx, qy, r.seed + 777)
      const wn = screenThreshold(r.screen, x, y, r.pixelSize, raw)
      const bounds = r.gradBounds ?? stops.map((_, i) => (i + 1) / stops.length)
      let seg = stops.length - 1
      for (let i = 0; i < bounds.length; i++) {
        if (t < bounds[i]) {
          seg = i
          break
        }
      }
      const start = seg === 0 ? 0 : bounds[seg - 1]
      let idx = seg
      if (r.gradDiscrete) {
        // Kit bands: mostly solid, a short dither at the top of each band.
        const frac = (t - start) / Math.max(bounds[seg] - start, 1e-6)
        const p = (frac - 0.78) / 0.22
        if (p > 0 && wn < p) idx = Math.min(seg + 1, stops.length - 1)
      } else {
        // Solid ink bands with a fixed-width dithered transition at each
        // boundary, so every stop (especially the thin accent) keeps a solid
        // core and the crossfade lives only at the seam.
        const w = r.gradSeam ?? 0.1
        if (seg > 0 && t - start < w) {
          const p = 0.5 - (t - start) / (2 * w)
          if (wn < p) idx = seg - 1
        } else if (seg < stops.length - 1 && bounds[seg] - t < w) {
          const p = 0.5 - (bounds[seg] - t) / (2 * w)
          if (wn < p) idx = seg + 1
        }
      }
      writePixel(
        data,
        (y * px + x) * 4,
        stops[idx],
        quantized ? 0 : grainJit(raw, r.grainIntensity),
      )
    }
  }
}

/** The halftone dome: every Create cover rises from the bottom edge (the
 *  gesture Writing proved out), rings sweeping deep → paper. Transitions are
 *  Screen-Covered dots in grain mode, ordered Bayer pixels in bayer mode. */
function renderHalftone(data: Uint8ClampedArray, px: number, r: Recipe): void {
  const origin = { x: px / 2, y: px * 1.05 }
  const maxD = Math.max(Math.hypot(origin.x, origin.y), Math.hypot(px - origin.x, origin.y))
  const rings = r.rings
  const cell = r.dotCell
  const trans = 0.14
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const d = Math.hypot(x - origin.x, y - origin.y) / maxD
      let band = rings.length - 1
      for (let i = 1; i < rings.length; i++) {
        if (d < i / rings.length) {
          band = i - 1
          break
        }
      }
      let col = rings[band]
      if (band < rings.length - 1) {
        const edge = (band + 1) / rings.length
        const p = (d - (edge - trans)) / trans
        if (p > 0) {
          if (r.screen === 'grain') {
            const gx = x - ((x % cell) - cell / 2)
            const gy = y - ((y % cell) - cell / 2)
            if (Math.hypot(x - gx, y - gy) < cell * 0.62 * Math.sqrt(p)) col = rings[band + 1]
          } else if (screenThreshold(r.screen, x, y, r.pixelSize, 0) < p) {
            col = rings[band + 1]
          }
        }
      }
      const wn = hash2(x, y, r.seed + 777)
      writePixel(
        data,
        (y * px + x) * 4,
        col,
        r.screen === 'grain' ? grainJit(wn, r.grainIntensity) : 0,
      )
    }
  }
}

/** Overprint. Skills print the three-slot grammar (anchor deep, mid, small
 *  accent). Kits print one circle per member on an arc, in member mids, with
 *  at most two ink passes on any pixel so the count stays readable. */
function renderOverprint(data: Uint8ClampedArray, px: number, r: Recipe): void {
  interface PxShape {
    kind: OverShape['kind']
    x: number
    y: number
    r: number
    w: number
    ink: RGB
  }
  let shapes: PxShape[]
  if (r.overArc) {
    const n = r.overInks.length
    const phase = hash2(9, 9, r.seed) * Math.PI * 2
    const arcR = px * (n <= 2 ? 0.17 : 0.26)
    shapes = r.overInks.map((ink, i) => {
      const a = phase + (i / n) * Math.PI * 2
      return {
        kind: 'circle' as const,
        x: px / 2 + Math.cos(a) * arcR,
        y: px / 2 + Math.sin(a) * arcR,
        r: px * (n <= 3 ? 0.3 : 0.26),
        w: 0,
        ink,
      }
    })
  } else {
    shapes = r.overShapes.map((s, i) => ({
      kind: s.kind,
      x: s.x * px,
      y: s.y * px,
      r: s.kind === 'bar' ? s.r : s.r * px,
      w: s.w * px,
      ink: r.overInks[Math.min(i, r.overInks.length - 1)],
    }))
  }
  const wob = px * 0.05
  const maxPasses = r.overArc ? 2 : 3

  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const n = (fbm(x / (r.grainScale * 1.4), y / (r.grainScale * 1.4), r.seed + 333) - 0.5) * wob
      let col: RGB = r.paper
      let passes = 0
      for (let i = 0; i < shapes.length && passes < maxPasses; i++) {
        const s = shapes[i]
        const wobble = i % 2 === 0 ? n : -n
        let inside: boolean
        if (s.kind === 'bar') {
          inside = Math.abs((x - s.x) * Math.cos(s.r) + (y - s.y) * Math.sin(s.r)) + wobble < s.w
        } else if (s.kind === 'ring') {
          inside = Math.abs(Math.hypot(x - s.x, y - s.y) - s.r) + wobble < s.w
        } else {
          inside = Math.hypot(x - s.x, y - s.y) + wobble < s.r
        }
        if (inside) {
          col = overIck(col, s.ink)
          passes++
        }
      }
      const wn = hash2(x, y, r.seed + 777)
      writePixel(
        data,
        (y * px + x) * 4,
        col,
        r.screen === 'grain' ? grainJit(wn, r.grainIntensity) : 0,
      )
    }
  }
}

/** How the glyph reads against the pressing:
 *  - `knockout` (default): the shape is the paper sheet showing through the ink
 *    — the classic bright cutout, single-source since the engine shipped.
 *  - `invert`: the shape is a deep-ink silhouette stamped onto the field.
 *  - `burn`: the pressing keeps painting through the shape, then the ink pools
 *    there (a same-hue overprint) — texture intact, no flat patch. */
export type GlyphMode = 'knockout' | 'invert' | 'burn'

/** Print the glyph into the pixels. Depending on {@link GlyphMode} the shape is
 *  a paper knockout (fBm-wobbled stencil edge), a deep-ink silhouette, or an
 *  overprint burn that darkens whatever the pressing painted underneath. When
 *  misprint is on, a deep-ink copy is multiplied with the ground where the drum
 *  drifted, visible only where it escapes the shape. */
function printGlyph(
  data: Uint8ClampedArray,
  px: number,
  r: Recipe,
  mask: Uint8ClampedArray,
  misprint: boolean,
  mode: GlyphMode = 'knockout',
): void {
  const dx = Math.round(r.driftX * px)
  const dy = Math.round(r.driftY * px)
  const deep = r.inks[0]
  // The color the shape fills with at pixel `o`. Knockout lays down the paper
  // sheet; invert lays down deep ink; burn reads the already-painted ground and
  // multiplies deep into it, so the pressing's texture survives inside the mark.
  const glyphFill = (o: number): RGB => {
    if (mode === 'invert') return deep
    if (mode === 'burn') return overIck([data[o], data[o + 1], data[o + 2]], deep)
    return r.paper
  }
  // In the quantized screens the glyph joins the raster: the mask is sampled
  // on the same pixel grid as the ground (chunky stencil, hard edge). Grain
  // mode keeps the fBm stencil edge and paper tooth.
  const chunky =
    r.screen === 'bayer2' || r.screen === 'bayer4' || r.screen === 'bayer8' ? r.pixelSize : 0
  const maskAt = (mx: number, my: number): number => {
    if (mx < 0 || my < 0 || mx >= px || my >= px) return 0
    if (chunky > 0) {
      const cx = Math.min(Math.floor(mx / chunky) * chunky + (chunky >> 1), px - 1)
      const cy = Math.min(Math.floor(my / chunky) * chunky + (chunky >> 1), px - 1)
      return mask[(cy * px + cx) * 4 + 3]
    }
    return mask[(my * px + mx) * 4 + 3]
  }
  // Soft coverage for the grain spray edge: a cheap 5-point blur of the mask.
  const blurAt = (mx: number, my: number): number =>
    (maskAt(mx, my) * 2 +
      maskAt(mx + 2, my) +
      maskAt(mx - 2, my) +
      maskAt(mx, my + 2) +
      maskAt(mx, my - 2)) /
    6
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const o = (y * px + x) * 4
      let inGlyph: boolean
      if (r.screen === 'grain') {
        // Riso stencil: fBm-wobbled edge, and ground speckle sprays into the
        // paper near the edge so the knockout is printed, not pasted.
        const c = blurAt(x, y)
        const edge = 128 + (fbm(x / 6, y / 6, r.seed + 888) - 0.5) * 150
        inGlyph = c > edge
        if (inGlyph) {
          const spray = c < 210 ? ((210 - c) / 210) * 0.75 : 0
          if (hash2(x, y, r.seed + 555) >= spray) {
            // Paper tooth jitter is a knockout affordance; ink fills stay flat.
            const jit = mode === 'knockout' ? -hash2(x, y, r.seed + 556) * 6 : 0
            writePixel(data, o, glyphFill(o), jit)
          }
          continue
        }
      } else if (r.screen === 'hatch') {
        // Solid stencil. (Running the line work through the knockout was
        // tried and shredded the glyphs.)
        inGlyph = maskAt(x, y) > 128
        if (inGlyph) {
          writePixel(data, o, glyphFill(o), 0)
          continue
        }
      } else {
        // Bayer: the glyph shares the pixel grid (maskAt chunks the samples).
        inGlyph = maskAt(x, y) > 128
        if (inGlyph) {
          writePixel(data, o, glyphFill(o), 0)
          continue
        }
      }
      if (!misprint) continue
      if (maskAt(x - dx, y - dy) > 128) {
        const ground: RGB = [data[o], data[o + 1], data[o + 2]]
        const col = overIck(ground, deep)
        writePixel(data, o, col, 0)
      }
    }
  }
}

/** The pure pixel pass: paint a recipe into a fresh RGBA buffer. No browser
 *  APIs — node-safe, so server renderers (OG cards) can print the exact same
 *  covers and encode them however they like. Marks/glyphs are NOT included
 *  (their rasterizer is browser-only); server consumers overlay them as SVG
 *  via the exported svg-part builders. */
export function renderRecipePixels(r: Recipe, px: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(px * px * 4)
  if (r.style === 'gradation') renderGradation(data, px, r)
  else if (r.style === 'halftone') renderHalftone(data, px, r)
  else renderOverprint(data, px, r)
  return data
}

export function renderRecipe(
  canvas: HTMLCanvasElement,
  r: Recipe,
  mask: Uint8ClampedArray | null,
  misprint: boolean,
  px = 216,
  glyphMode: GlyphMode = 'knockout',
): void {
  canvas.width = px
  canvas.height = px
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.createImageData(px, px)
  img.data.set(renderRecipePixels(r, px))
  if (mask) printGlyph(img.data, px, r, mask, misprint, glyphMode)
  ctx.putImageData(img, 0, 0)
}

// ── Marks (rasterized once, cached) ──────────────────────────────────────────

const maskCache = new Map<string, Promise<Uint8ClampedArray>>()

/** A skill prints its category glyph. */
/** Two optical cuts, like type: the LIST cut (glyph dominates for
 *  identification, sturdier stroke) and the DISPLAY cut for hero sizes ≥96px
 *  (the title does the naming, the glyph grows into the field and its stroke
 *  thins so it doesn't go chunky). */
export function glyphOptics(displaySize: number): { frac: number; stroke: number } {
  return displaySize >= 96 ? { frac: 0.52, stroke: 1.5 } : { frac: 0.46, stroke: 1.6 }
}

/** The centered category glyph as an SVG group in `px`-space — the shared
 *  geometry behind the browser mask AND server overlays (OG cards), so the
 *  printed glyph is identical everywhere. `color` inks the strokes/fills. */
export function glyphSvgGroup(
  key: CategoryKey,
  px: number,
  frac = 0.46,
  stroke = 1.6,
  color = '#fff',
): string {
  const inset = (px * (1 - frac)) / 2
  const scale = (px * frac) / 16
  return `<g transform="translate(${inset} ${inset}) scale(${scale})" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" style="color:${color}">${CATEGORY_GLYPHS[key]}</g>`
}

export function glyphMask(
  key: CategoryKey,
  px: number,
  frac = 0.46,
  stroke = 1.6,
): Promise<Uint8ClampedArray> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">${glyphSvgGroup(key, px, frac, stroke)}</svg>`
  return rasterMask(svg, px, `${key}-${px}-${frac}-${stroke}`)
}

/** A kit prints its composition as weighted SECTION MARKS — the production
 *  vocabulary (□ Code, ○ Create, △ Grow), up to three, each sized by how many
 *  members the kit holds of that section (area ∝ share). Geometry survives
 *  every size where category glyphs turned to noise. */
export function kitMarkMask(
  members: CategoryKey[],
  px: number,
  /** Below ~56px three weighted marks turn to noise; solo prints only the
   *  dominant section's mark at full scale, like a homogeneous kit. */
  solo = false,
  /** Visible height fraction of the square print when the container is wider
   *  than tall and center-crops it (h/w, 1 for square). Marks stay at the
   *  square's center (a symmetric crop keeps them centered); the edition
   *  stamp anchors to the VISIBLE foot so it never runs into the crop edge. */
  visibleFrac = 1,
  /** Edition stamp placement (see kitMarkSvgParts). */
  stamp: 'foot' | 'inside' = 'foot',
): Promise<Uint8ClampedArray> {
  const { parts, sig, total } = kitMarkSvgParts(members, px, solo, visibleFrac, '#fff', 1, stamp)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">${parts}</svg>`
  return rasterMask(
    svg,
    px,
    `kit-${sig}-n${total}-${solo ? 'solo' : 'row'}-f${visibleFrac.toFixed(2)}-${px}`,
  )
}

/** The kit's marks + edition stamp as SVG parts in `px`-space — the shared
 *  geometry behind the browser mask AND server overlays (OG cards). `fill`
 *  inks the shapes (the mask uses white; overlays pass the paper color). */
export function kitMarkSvgParts(
  members: CategoryKey[],
  px: number,
  solo = false,
  visibleFrac = 1,
  fill = '#fff',
  /** Visible WIDTH fraction when a taller-than-wide container center-crops
   *  the square horizontally (w/h, 1 for square) — the OG stage. Marks stay
   *  centered; the stamp's left inset shifts inside the visible band. */
  visibleWFrac = 1,
  /** Edition stamp placement. 'foot' (default) tallies the count along the
   *  bottom-left foot. 'inside' punches the tally as holes in the dominant
   *  mark, so under a burn/knockout the count reads as lighter ticks within
   *  the focal shape instead of a detached corner mark. */
  stamp: 'foot' | 'inside' = 'foot',
): { parts: string; sig: string; total: number } {
  const counts = new Map<CategorySection, number>()
  for (const k of members) {
    const s = CATEGORY_SWATCHES[k].section
    counts.set(s, (counts.get(s) ?? 0) + 1)
  }
  const order: CategorySection[] = ['Code', 'Create', 'Grow']
  let entries = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]),
  )
  if (solo) entries = entries.slice(0, 1)
  const total = members.length
  const base = px * 0.175
  // Weighted sizes, then the display order: with three marks the biggest sits
  // in the MIDDLE (podium), with two the dominant leads.
  let marks = entries.map(([s, count]) => ({
    section: s,
    count,
    h: solo ? base : base * Math.sqrt(count / total),
  }))
  if (marks.length === 3) marks = [marks[1], marks[0], marks[2]]
  const gap = px * 0.055
  const rowW = marks.reduce((a, m) => a + 2 * m.h, 0) + gap * (marks.length - 1)
  let x = (px - rowW) / 2
  const cy = px / 2
  // Inside stamp: each shape punches ITS OWN section count as holes (circle =
  // Create count, triangle = Grow count, square = Code count), so every mark is
  // self-describing — the count lives with the identity, no separate corner
  // stamp. The count is a ROMAN numeral drawn as STROKES (I/V/X), not a font:
  // seven identical bars read as noise inside a small shape, but VII reads as a
  // number while staying pure geometry. Kits never realistically pass 39, so
  // only I/V/X are needed (L/C/M would drift into letters); a count that does
  // exceed 39 falls back to a plain bar tally. Sized off each shape and scaled
  // to fit its inner span; the triangle's mass sits below center, so its
  // numeral drops to the centroid.
  let defs = ''
  const romanTokens = (n: number): string[] => {
    const map: [number, string][] = [
      [10, 'X'],
      [9, 'IX'],
      [5, 'V'],
      [4, 'IV'],
      [1, 'I'],
    ]
    let r = ''
    let rem = n
    for (const [v, sym] of map) {
      while (rem >= v) {
        r += sym
        rem -= v
      }
    }
    return r.split('')
  }
  const numHoles = (count: number, cx: number, cyc: number, h: number): string => {
    if (count <= 0) return ''
    if (count > 39) {
      // Beyond roman's I/V/X range: a plain bar tally, scaled to fit.
      let uw = Math.max(1.4, h * 0.12)
      let uGap = Math.max(1.2, h * 0.14)
      const th = h * 0.72
      let rowW2 = count * uw + (count - 1) * uGap
      const maxW = h * 1.5
      if (rowW2 > maxW) {
        const s = maxW / rowW2
        uw *= s
        uGap *= s
        rowW2 *= s
      }
      let ix = cx - rowW2 / 2
      let bars = ''
      for (let i = 0; i < count; i++) {
        bars += `<rect x="${ix.toFixed(2)}" y="${(cyc - th / 2).toFixed(2)}" width="${uw.toFixed(2)}" height="${th.toFixed(2)}" rx="${(uw / 2).toFixed(2)}" fill="black"/>`
        ix += uw + uGap
      }
      return bars
    }
    const tokens = romanTokens(count)
    // Proportional to the shape, but capped to a fraction of the TILE so a
    // dominant (near-solo) shape doesn't get an oversized numeral — the count is
    // a quiet inlay, not the subject. Minor shapes stay below the cap and scale
    // with their mark.
    let H = Math.min(h * 0.5, px * 0.07)
    let sw = Math.max(1.1, H * 0.13)
    // Per-glyph drawn width; I is a single bar (width ~ its stroke).
    const widthOf = (t: string): number => (t === 'I' ? sw : t === 'V' ? H * 0.58 : H * 0.56)
    let gap = H * 0.24
    let widths = tokens.map(widthOf)
    let total = widths.reduce((a, w) => a + w, 0) + gap * (tokens.length - 1)
    // Keep the numeral clear of the shape's edge (a circle of radius h loses
    // width off-center, so cap well inside the diameter).
    const maxW = h * 1.02
    if (total > maxW) {
      const s = maxW / total
      H *= s
      sw *= s
      gap *= s
      widths = widths.map((w) => w * s)
      total *= s
    }
    const top = cyc - H / 2
    const bot = cyc + H / 2
    const line = (x1: number, y1: number, x2: number, y2: number): string =>
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="black" stroke-width="${sw.toFixed(2)}" stroke-linecap="round"/>`
    let sx = cx - total / 2
    let holes = ''
    tokens.forEach((t, i) => {
      const w = widths[i]
      const gc = sx + w / 2
      if (t === 'I') holes += line(gc, top, gc, bot)
      else if (t === 'V') holes += line(gc - w / 2, top, gc, bot) + line(gc + w / 2, top, gc, bot)
      else holes += line(gc - w / 2, top, gc + w / 2, bot) + line(gc + w / 2, top, gc - w / 2, bot)
      sx += w + gap
    })
    return holes
  }
  let out = ''
  marks.forEach((m, i) => {
    const h = m.h
    const cx = x + h
    let maskAttr = ''
    if (stamp === 'inside' && m.count > 0) {
      // Triangle ticks drop to the centroid (~0.16h below center); square and
      // circle center on cy.
      const cyc = m.section === 'Grow' ? cy + h * 0.14 : cy
      const holes = numHoles(m.count, cx, cyc, h)
      if (holes) {
        defs += `<mask id="stampcut${i}" maskUnits="userSpaceOnUse" x="0" y="0" width="${px}" height="${px}"><rect x="0" y="0" width="${px}" height="${px}" fill="white"/>${holes}</mask>`
        maskAttr = ` mask="url(#stampcut${i})"`
      }
    }
    if (m.section === 'Code') {
      const half = h * 0.92
      out += `<rect x="${cx - half}" y="${cy - half}" width="${half * 2}" height="${half * 2}" rx="${half * 0.36}" fill="${fill}"${maskAttr}/>`
    } else if (m.section === 'Create') {
      out += `<circle cx="${cx}" cy="${cy}" r="${h}" fill="${fill}"${maskAttr}/>`
    } else {
      // Optical correction: the round-joined stroke bloats the triangle past
      // its nominal size, so an "equal" triangle beat an equal circle. Scale
      // it down and thin the stroke to bring the masses level.
      const ht = h * 0.86
      out += `<polygon points="${cx},${cy - ht * 1.08} ${cx + ht},${cy + ht * 0.82} ${cx - ht},${cy + ht * 0.82}" fill="${fill}" stroke="${fill}" stroke-width="${ht * 0.3}" stroke-linejoin="round"${maskAttr}/>`
    }
    x += 2 * h + gap
  })
  if (defs) out = `<defs>${defs}</defs>` + out
  // The EDITION stamp: the kit's member count as counting lines along the
  // foot, in the RULER idiom — a tall tick is ten members, a short tick is
  // one — with each tier grouped in fives by a wider gap. Pure geometry, no
  // typography: roman numerals were considered (they are literally
  // compressed tallies — V is the strike, X two crossed) but L/C/M cross
  // into letters, and the cover language carries none. Honest at any size a
  // kit realistically reaches; 100+ leaves counting to the label text, and
  // solo (small) covers never carry the stamp. Geometry is integer-snapped
  // in device pixels — fractional positions rasterized uneven tick weights —
  // and inset 10% with a lifted baseline, clear of the tile's corner radius.
  if (stamp === 'foot' && !solo && total <= 99) {
    const tens = Math.floor(total / 10)
    const ones = total % 10
    // Optical cut for the stamp, like the glyphs: proportional at chip sizes,
    // but capped in device pixels so big prints get THINNER, TIGHTER ticks
    // instead of chunky upscaled ones.
    const tw = Math.min(3, Math.max(2, Math.round(px * 0.014)))
    // Tick heights run 25% taller than the base ruler cut (a hair more presence
    // in the corner without changing the tally's weight or spacing).
    const thTen = Math.min(20, Math.round(px * 0.075))
    const thOne = Math.min(13, Math.round(px * 0.045))
    const tickGap = Math.min(4, Math.max(2, Math.round(px * 0.02)))
    const groupGap = Math.min(9, Math.max(4, Math.round(px * 0.045)))
    const tierGap = Math.min(12, Math.max(6, Math.round(px * 0.06)))
    // Square tiles keep generous insets (the rounded corner needs distance).
    // Wide card crops end in a straight seam with a text block below — there
    // the stamp aligns like typography: on the title's left axis (~card
    // padding) and closer to the seam, reading as the first line of the
    // column.
    const f = Math.max(0.4, Math.min(visibleFrac, 1))
    const wide = f < 0.98
    const base = Math.round(px * (0.5 + f / 2 - (wide ? 0.095 : 0.12) * f))
    // Square tiles inset further left than wide cards: the 16% corner radius
    // curves into a 10% inset, so the stamp starts at 12% to sit clear of it.
    // Horizontally-cropped stages start inside the visible band.
    const wf = Math.max(0.4, Math.min(visibleWFrac, 1))
    let tx = Math.round(px * ((1 - wf) / 2 + (wide ? 0.065 : 0.12) * wf))
    const tier = (count: number, th: number): void => {
      for (let i = 0; i < count; i++) {
        out += `<rect x="${tx}" y="${base - th}" width="${tw}" height="${th}" fill="${fill}"/>`
        tx += tw + tickGap
        if (i % 5 === 4) tx += groupGap - tickGap
      }
    }
    tier(tens, thTen)
    if (tens > 0 && ones > 0) tx += tierGap - tickGap
    tier(ones, thOne)
  }
  const sig = entries.map(([s, count]) => `${s}${count}`).join('-') + `-${stamp}`
  return { parts: out, sig, total }
}

function rasterMask(svg: string, px: number, cacheKey: string): Promise<Uint8ClampedArray> {
  const hit = maskCache.get(cacheKey)
  if (hit) return hit
  const p = new Promise<Uint8ClampedArray>((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const c = document.createElement('canvas')
      c.width = px
      c.height = px
      const ctx = c.getContext('2d')
      if (!ctx) {
        reject(new Error('2d context unavailable'))
        return
      }
      ctx.drawImage(img, 0, 0)
      resolve(ctx.getImageData(0, 0, px, px).data)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('mask raster failed'))
    }
    img.src = url
  })
  maskCache.set(cacheKey, p)
  return p
}

// ── Production defaults ───────────────────────────────────────────────────────

/** The shipped pressing: one fine Bayer screen, moderate grain, run 42. */
export const DEFAULT_GRAIN: GrainOpts = {
  grainIntensity: 0.35,
  grainScale: 30,
  screen: 'bayer8',
  pixelSize: 1,
}

export const PRESS_SEED = 42

// ── Shared print geometry (both surface adapters read these — the numbers
// must never drift between web and desktop) ──────────────────────────────────

/** Below this display size (CSS px) kit covers paint the solo dominant mark. */
export const SOLO_MARK_MAX = 56

/** Backing-canvas resolution for a display size: native device pixels,
 *  clamped so tiny chips stay crisp and heroes stay cheap. (448 rather than
 *  320: featured-card-size prints upscaled visibly at 320.) */
export function printPx(displaySize: number, devicePixelRatio: number): number {
  const dpr = Math.min(devicePixelRatio || 1, 2)
  return Math.max(48, Math.min(448, Math.round(displaySize * dpr)))
}
