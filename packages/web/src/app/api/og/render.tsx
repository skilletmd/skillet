import { ImageResponse } from 'next/og'
import type { ReactNode } from 'react'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { OgArgs } from '@/lib/og'
import { avatarHue, avatarInitials, avatarTint, defaultAvatarUrl } from '@/lib/avatar-color'
import { CATEGORY_BY_KEY, isCategoryKey, swatchHsl } from '@/lib/categories'
import { coverHue } from './cover-hue'
import {
  brandCategory,
  brandStagePngUri,
  coverMarksSvgUri,
  paintedCoverPngUri,
} from './painted-cover'

// Branded OG card renderer. Single source used by /api/og (dynamic) and any
// file-convention opengraph-image route, so every share card looks identical and
// on-brand. Skills/kits carry their real generated cover, people their avatar,
// and a facepile of real users — so a Skillet link reads as a product, not a
// boring github-link card.

const BG = '#f7f5ee'
const INK = '#171512'
const INK2 = '#68635b'
const ACCENT = '#2f6f8f'
const LINE = 'rgba(23,21,18,0.12)'

// The skill/kit cover is the real painted cover, rasterized for satori — see
// painted-cover.ts. cover-hue.ts supplies the matching dominant tint for the card.

// A stable hue (0–359) seeded from a string — gives each brand/default page
// (home, docs, feed…) its own consistent stage color instead of one fixed teal.
function hueFromString(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = ((h ^ s.charCodeAt(i)) * 16777619) >>> 0
  return h % 360
}

// ── assets (fonts, logos, faces) ────────────────────────────────────────────
async function loadFace(handle: string): Promise<string | null> {
  try {
    const rel = defaultAvatarUrl(handle).replace(/^\//, '').split('?')[0]
    const buf = await readFile(path.join(process.cwd(), 'public', rel))
    return `data:image/svg+xml;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

const FONT = {
  mono: 'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff',
  sans: 'https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-400-normal.woff',
  sansBold: 'https://cdn.jsdelivr.net/npm/@fontsource/inter/files/inter-latin-700-normal.woff',
}

type FontDef = { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: 'normal' }
type Assets = { fonts: FontDef[]; logoInk: string | null; logoLight: string | null; grain: string | null }
let assetsPromise: Promise<Assets> | null = null

async function loadGrain(): Promise<string | null> {
  try {
    const buf = await readFile(path.join(process.cwd(), 'public', 'brand', 'grain.png'))
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}

async function loadLogo(
  tint: string,
  opts?: { dilate?: number; erodeFeatures?: number },
): Promise<string | null> {
  try {
    const raw = await readFile(
      path.join(process.cwd(), 'public', 'brand', 'skillet-mascot-logo.svg'),
      'utf8',
    )
    let tinted = raw.replace(/#000000/g, tint).replace(/stroke:#000\b/g, `stroke:${tint}`)
    // The mascot is a traced FILL (no strokes): weight changes are done with
    // morphology filters. Path 1 is the hat+head outline; paths 2-4 are the
    // eyes and mouth, which trace heavier than the outline — eroding just
    // them brings the face weight level. Radii are in the path coordinate
    // space (10x the viewBox).
    if (opts?.dilate || opts?.erodeFeatures) {
      const defs = `<defs>${
        opts.dilate
          ? `<filter id="fat" x="-5%" y="-5%" width="110%" height="110%"><feMorphology operator="dilate" radius="${opts.dilate}"/></filter>`
          : ''
      }${
        opts.erodeFeatures
          ? `<filter id="thin" x="-5%" y="-5%" width="110%" height="110%"><feMorphology operator="erode" radius="${opts.erodeFeatures}"/></filter>`
          : ''
      }</defs>`
      tinted = tinted.replace(/<g /, `${defs}<g `)
      if (opts.dilate) tinted = tinted.replace(/<g /, `<g filter="url(#fat)" `)
      if (opts.erodeFeatures) {
        let i = 0
        tinted = tinted.replace(/<path /g, (m) => {
          i += 1
          return i >= 2 ? `<path filter="url(#thin)" ` : m
        })
      }
    }
    return `data:image/svg+xml;base64,${Buffer.from(tinted).toString('base64')}`
  } catch {
    try {
      const buf = await readFile(
        path.join(process.cwd(), 'public', 'brand', 'skillet-mascot-logo.png'),
      )
      return `data:image/png;base64,${buf.toString('base64')}`
    } catch {
      return null
    }
  }
}

async function loadAssets() {
  if (!assetsPromise) {
    assetsPromise = (async () => {
      const fetchBuf = async (u: string) => {
        const r = await fetch(u)
        if (!r.ok) throw new Error(`font ${r.status}`)
        return r.arrayBuffer()
      }
      let fonts: FontDef[] = []
      try {
        const [mono, sans, sansBold] = await Promise.all([
          fetchBuf(FONT.mono),
          fetchBuf(FONT.sans),
          fetchBuf(FONT.sansBold),
        ])
        fonts = [
          { name: 'Mono', data: mono, weight: 600, style: 'normal' },
          { name: 'Sans', data: sans, weight: 400, style: 'normal' },
          { name: 'Sans', data: sansBold, weight: 700, style: 'normal' },
        ]
      } catch {
        fonts = []
      }
      const [logoInk, logoLight, grain] = await Promise.all([
        // Header lockup: the clean mark — dilation fused the face (tried
        // and cut); scale alone carries the weight.
        loadLogo(INK),
        // Stage hero: eyes/mouth eroded level with the hat/head outline.
        loadLogo(BG, { erodeFeatures: 20 }),
        loadGrain(),
      ])
      return { fonts, logoInk, logoLight, grain }
    })()
  }
  return assetsPromise
}

// ── small render helpers ────────────────────────────────────────────────────
// An avatar disc: illustrated face (people) or a monogram (teams / missing).
function AvatarDisc({
  handle,
  face,
  size,
  isTeam,
  font,
  ring,
}: {
  handle: string
  face: string | null
  size: number
  isTeam: boolean
  font: string
  ring?: string
}) {
  // satori won't clip a child <img> to the parent's overflow:hidden + radius, so
  // the face leaks past the circle — put the radius on the <img> itself.
  const radius = isTeam ? `${Math.round(size * 0.26)}px` : '999px'
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: avatarTint(handle),
        color: INK,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.38),
        fontWeight: 700,
        fontFamily: font,
        overflow: 'hidden',
        flex: '0 0 auto',
        border: ring ? `${Math.max(2, Math.round(size * 0.06))}px solid ${ring}` : `1px solid ${INK}1a`,
      }}
    >
      {face && !isTeam ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={face} width={size} height={size} alt="" style={{ objectFit: 'cover', borderRadius: radius }} />
      ) : (
        avatarInitials(handle)
      )}
    </div>
  )
}

export async function renderOgImage(a: OgArgs): Promise<ImageResponse> {
  const variant = (a.type ?? 'generic').toLowerCase()
  const eyebrow = a.eyebrow ?? ''
  const title = a.title ?? 'Skillet'
  const subtitle = a.subtitle ?? ''
  const handle = a.handle ?? ''
  const stat = a.stat ?? ''
  const isTeam = a.team === true
  const mark = a.mark ?? ''
  const cats = a.cats ?? []
  const faces = (a.faces ?? []).filter(Boolean).slice(0, 5)

  const { fonts, logoInk, logoLight, grain } = await loadAssets()
  const sans = fonts.length ? 'Sans' : 'system-ui'
  const mono = fonts.length ? 'Mono' : 'system-ui'

  const isProfile = variant === 'profile' || variant === 'team'
  const isSkill = variant === 'skill'
  const isKit = variant === 'kit'

  // Faces we need to read off disk: identity handle + facepile, all in parallel.
  const faceHandles = Array.from(new Set([handle, ...faces].filter(Boolean)))
  const faceMap = new Map(
    await Promise.all(
      faceHandles.map(async (h) => [h, await loadFace(h)] as const),
    ),
  )

  // Entity slugs read as NAMES on a share card: hyphens to spaces, title case.
  const displayTitle =
    isSkill || isKit
      ? title.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
      : title
  const titleFont = isSkill ? mono : sans
  // The right ~40% is a color stage, so the title column runs narrower. Size
  // scales down with length so short titles (names, one-word slugs) fill the
  // space and long ones still fit.
  const tlen = title.length
  const titleSize =
    variant === 'home'
      ? 82 // the homepage headline is the hero — oversized on purpose
      : variant === 'blog'
        ? // Blog cards are a lone title in the column (no author row, chips,
          // or pile), so the ladder runs a class hotter and headlines fill
          // the space they have.
          tlen <= 18
          ? 76
          : tlen <= 30
            ? 66
            : tlen <= 44
              ? 56
              : tlen <= 60
                ? 48
                : 42
        : tlen <= 7
          ? 88
          : tlen <= 12
            ? 76
            : tlen <= 18
              ? 64
              : tlen <= 26
                ? 54
                : tlen <= 36
                  ? 46
                  : 40

  // Skill/kit covers paint the real cover — the same pixel engine as the
  // page and desktop (see painted-cover.ts), marks overlaid as SVG.
  const coverSeed = mark || (isSkill ? `${handle}/${title}` : title)

  // Each card carries its own signature hue — the skill/kit cover color, a
  // person's avatar hue, or (brand/default pages) a hue seeded from the page type
  // so each one is stable and distinct. The right ~40% becomes a saturated
  // "stage" in that hue; the left stays cream, faintly tinted toward the seam.
  const isBrand = !isSkill && !isKit && !(isProfile && handle)
  // Home is THE brand card — pin it to the brand teal; other utility pages get a
  // stable seeded hue for variety.
  const washHue =
    isSkill || isKit
      ? coverHue(coverSeed, cats)
      : isProfile && handle
        ? avatarHue(handle)
        : CATEGORY_BY_KEY[brandCategory(variant)].hue
  const cardBg = `linear-gradient(90deg, ${BG} 50%, hsl(${washHue} 52% 93%) 100%)`
  // Brand stages run darker (a cream mascot floats on them); entity stages run
  // lighter (the cover/avatar art is dark enough to read on its own).
  const stageBg = isBrand
    ? // a top glow gives the panel real depth (not a flat color block)
      `radial-gradient(110% 78% at 50% 14%, hsl(${washHue} 64% 64%) 0%, transparent 60%), linear-gradient(155deg, hsl(${washHue} 56% 50%) 0%, hsl(${washHue} 62% 31%) 100%)`
    : `linear-gradient(155deg, hsl(${washHue} 64% 72%) 0%, hsl(${washHue} 60% 49%) 100%)`
  const STAGE = 496
  const ON_STAGE = 408
  const WHITE_RING = '1px solid rgba(255,255,255,0.55)'

  let stageVisual: ReactNode = null
  if (isSkill || isKit) {
    // The cover IS the stage: the square print fills the full panel, cropped
    // left/right (marks stay centered under the symmetric crop; the edition
    // stamp shifts inside the visible band via visibleWFrac).
    const PRINT = 630
    const CROP_X = Math.round((PRINT - STAGE) / 2)
    const ground = paintedCoverPngUri(coverSeed, cats, PRINT)
    const marks = coverMarksSvgUri(coverSeed, cats, PRINT, STAGE / PRINT)
    stageVisual = (
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: STAGE,
          height: 630,
          display: 'flex',
          overflow: 'hidden',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={ground} width={PRINT} height={PRINT} alt="" style={{ position: 'absolute', top: 0, left: -CROP_X }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={marks} width={PRINT} height={PRINT} alt="" style={{ position: 'absolute', top: 0, left: -CROP_X }} />
      </div>
    )
  } else if (isProfile && handle) {
    // The avatar IS the stage — full bleed on its tint, like the covers.
    stageVisual = (
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: STAGE,
          height: 630,
          background: avatarTint(handle),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          fontFamily: mono,
          fontSize: 210,
          fontWeight: 700,
          color: INK,
        }}
      >
        {faceMap.get(handle) && !isTeam ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={faceMap.get(handle) as string}
            width={630}
            height={630}
            alt=""
            style={{ objectFit: 'cover' }}
          />
        ) : (
          avatarInitials(handle)
        )}
      </div>
    )
  } else if (logoLight) {
    // Brand cards — the mascot, sized as a hero on the colored stage.
    // eslint-disable-next-line @next/next/no-img-element
    stageVisual = <img src={logoLight} width={244} height={348} alt="" style={{ objectFit: 'contain' }} />
  }

  // Body lead-in: the uppercase eyebrow (SKILL / KIT / DOCS...). The author
  // row sits under the title for entities.
  const bodyLead = eyebrow ? (
      <div
        style={{
          display: 'flex',
          fontFamily: mono,
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: ACCENT,
          marginBottom: 20,
        }}
      >
        {eyebrow}
      </div>
    ) : null

  // Top-category chips (profiles) — what an author is known for, mirroring the
  // /browse people card: a colored category dot + label.
  const profileCats = isProfile ? cats.filter(isCategoryKey).slice(0, 3) : []
  const categoryChips =
    profileCats.length > 0 ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 24 }}>
        {profileCats.map((c) => {
          const cat = CATEGORY_BY_KEY[c]
          return (
            <div
              key={c}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 9,
                border: `1px solid ${LINE}`,
                background: 'rgba(255,255,255,0.5)',
                borderRadius: 999,
                padding: '7px 15px 7px 12px',
              }}
            >
              <div style={{ width: 12, height: 12, borderRadius: 999, background: swatchHsl(cat) }} />
              <div style={{ display: 'flex', fontFamily: mono, fontSize: 18, fontWeight: 600, color: INK }}>
                {cat.label}
              </div>
            </div>
          )
        })}
      </div>
    ) : null

  // Facepile + stat — real people who use this skill/kit, then the count. A
  // pile needs at least three faces to read as a crowd; below that it looks
  // like a stray avatar, so the stat stands alone.
  const pile =
    faces.length >= 3 ? (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 30 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {faces.map((h, i) => (
            <div key={h} style={{ display: 'flex', marginLeft: i === 0 ? 0 : -16 }}>
              <AvatarDisc handle={h} face={faceMap.get(h) ?? null} size={52} isTeam={false} font={mono} ring={BG} />
            </div>
          ))}
        </div>
        {stat ? (
          <div style={{ display: 'flex', fontFamily: mono, fontSize: 23, fontWeight: 600, color: INK }}>
            {stat}
          </div>
        ) : null}
      </div>
    ) : stat ? (
      <div
        style={{
          display: 'flex',
          fontFamily: mono,
          fontSize: 22,
          fontWeight: 600,
          color: INK,
          marginTop: 28,
        }}
      >
        {stat}
      </div>
    ) : null

  return new ImageResponse(
    <div
      style={{
        width: '1200px',
        height: '630px',
        display: 'flex',
        position: 'relative',
        background: cardBg,
        fontFamily: sans,
      }}
    >
      {/* left — text column */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          padding: '50px 48px 56px 64px',
        }}
      >
        {/* header — skillet one-liner (logo + tagline) */}
        {/* The site nav lockup, scaled: mark 36x46 : 16px semibold mono : 6px
            gap, held at the same ratios (~2.9x text height, 0.375x gap). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {logoInk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoInk} width={99} height={127} alt="" style={{ objectFit: 'contain' }} />
          ) : null}
          <div style={{ display: 'flex', fontFamily: mono, fontSize: 44, fontWeight: 600, color: INK }}>
            Skillet
          </div>
        </div>

        {/* body — padding-bottom biases the block a touch above true center,
            which reads balanced against the footer chip. */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0, paddingBottom: 44 }}>
          {bodyLead}
          <div
            style={{
              display: 'flex',
              fontFamily: titleFont,
              fontSize: titleSize,
              lineHeight: 1.12,
              fontWeight: 700,
              color: INK,
              letterSpacing: '-1.5px',
            }}
          >
            {displayTitle}
          </div>
          {(isSkill || isKit) && handle ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 26 }}>
              <AvatarDisc handle={handle} face={faceMap.get(handle) ?? null} size={56} isTeam={isTeam} font={mono} />
              <div style={{ display: 'flex', fontFamily: mono, fontSize: 29, fontWeight: 600, color: INK }}>
                @{handle}
              </div>
            </div>
          ) : null}
          {subtitle ? (
            <div style={{ display: 'flex', fontSize: 26, lineHeight: 1.3, color: INK2, marginTop: 18 }}>
              {subtitle}
            </div>
          ) : null}
          {categoryChips}
          {pile}
        </div>
      </div>

      {/* right — the stage: brand pages print a painted roll in a system hue
          (the mascot floats on it); entity pages keep the tinted gradient
          behind their cover/avatar art. */}
      <div
        style={{
          width: STAGE,
          height: 630,
          flex: '0 0 auto',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: stageBg,
        }}
      >
        {isBrand ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={brandStagePngUri(variant, 630)}
            width={630}
            height={630}
            alt=""
            style={{ position: 'absolute', top: 0, left: 0, width: STAGE, height: 630, objectFit: 'cover' }}
          />
        ) : null}
        {stageVisual}
      </div>
    </div>,
    { width: 1200, height: 630, fonts: fonts.length ? fonts : undefined },
  )
}
