'use client'

/**
 * Cover experiments lab: a design surface for the cover system. The production
 * engine lives in @skillet/protocol/covers (SVG) + the painted canvas, consumed
 * through components/cover/*; this page renders states of the system with
 * controls, sample kits, tray context, and legibility rows.
 */

import { useMemo, useState } from 'react'
import { categoryCoverSvg } from '@skillet/protocol/covers'
import {
  STYLES,
  glyphMask,
  kitMarkMask,
  kitRecipe,
  skillRecipe,
  type GrainOpts,
  type Recipe,
  type Screen,
  type ScreenMode,
  type StyleMode,
  type GlyphMode,
} from '@/lib/cover-canvas'
import { CoverCanvas } from '@/components/cover/painted-cover'
import {
  CATEGORIES_BY_SECTION,
  CATEGORY_BY_KEY,
  SECTION_LABEL,
  type Category,
  type CategoryKey,
} from '@/lib/categories'

function SkillCover({
  cat,
  recipe,
  size,
  misprint,
  glyph,
  glyphMode,
}: {
  cat: Category
  recipe: Recipe
  size: number
  misprint: boolean
  glyph: boolean
  glyphMode: GlyphMode
}) {
  return (
    <div
      className="relative shrink-0 overflow-hidden"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.16) }}
    >
      <CoverCanvas
        recipe={recipe}
        size={size}
        maskKey={glyph ? `${cat.key}:${glyphMode}` : null}
        getMask={(px) => glyphMask(cat.key, px)}
        misprint={misprint}
        glyphMode={glyphMode}
      />
    </div>
  )
}

function KitCover({
  members,
  recipe,
  size,
  misprint,
  glyph,
  glyphMode,
  stamp,
}: {
  members: CategoryKey[]
  recipe: Recipe
  size: number
  misprint: boolean
  glyph: boolean
  glyphMode: GlyphMode
  stamp: 'foot' | 'inside'
}) {
  return (
    <div
      className="relative shrink-0 overflow-hidden"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.16) }}
    >
      <CoverCanvas
        recipe={recipe}
        size={size}
        maskKey={
          glyph
            ? `kit:${members.join(',')}:${size < 56 ? 'solo' : 'row'}:${glyphMode}:${stamp}`
            : null
        }
        getMask={(px) => kitMarkMask(members, px, size < 56, 1, stamp)}
        misprint={misprint}
        glyphMode={glyphMode}
      />
    </div>
  )
}

/** A faithful slice of the desktop Latest list, on the tray's dark chrome:
 *  skills keep the production app-icon cover (quiet, from the shared engine),
 *  kits get the riso print. */
function TrayRow({ cover, title, sub }: { cover: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="relative h-9 w-9 shrink-0 overflow-hidden rounded-[9px]">{cover}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium" style={{ color: '#ece9e4' }}>
          {title}
        </span>
        <span className="block text-xs" style={{ color: '#8d8880' }}>
          {sub}
        </span>
      </span>
    </div>
  )
}

function TrayContext({
  kitRecipes,
  misprint,
  glyphMode,
  stamp,
}: {
  kitRecipes: Recipe[]
  misprint: boolean
  glyphMode: GlyphMode
  stamp: 'foot' | 'inside'
}) {
  const skillCover = (key: CategoryKey): React.ReactNode => (
    <span
      className="absolute inset-0"
      dangerouslySetInnerHTML={{ __html: categoryCoverSvg(key, { dark: true }) }}
    />
  )
  const kitCover = (i: number): React.ReactNode => (
    <KitCover
      members={SAMPLE_KITS[i].members}
      recipe={kitRecipes[i]}
      size={36}
      misprint={misprint}
      glyph
      glyphMode={glyphMode}
      stamp={stamp}
    />
  )
  return (
    <div
      className="w-[360px] max-w-full rounded-2xl p-2"
      style={{ background: '#242019', border: '1px solid #37322a' }}
    >
      <TrayRow cover={skillCover('finance')} title="Refund policy" sub="@you" />
      <TrayRow cover={kitCover(0)} title="Ship a web app" sub="6 skills · @you" />
      <TrayRow cover={skillCover('devops')} title="Deploy ritual" sub="@you" />
      <TrayRow cover={kitCover(1)} title="Launch content" sub="5 skills · @team" />
      <TrayRow cover={skillCover('quality')} title="PR review checklist" sub="@simonw" />
      <TrayRow cover={kitCover(2)} title="Agent starter" sub="2 skills · @you" />
    </div>
  )
}

// Five hypothetical skills in ONE category: same ink and glyph, but each ref
// seeds its own pressing (direction, shade anchors, screen cell), so category
// rows never clone.
const SAMPLE_QUALITY_SKILLS: { ref: string }[] = [
  { ref: 'grace-reviews/pr-review-strict' },
  { ref: 'simonw/review-checklist' },
  { ref: 'devops-dan/security-pass' },
  { ref: 'pm-priya/test-coverage-gaps' },
  { ref: 'k-dense-ai/nitpick-bot' },
]

// Sample kits spanning sizes and sections.
const SAMPLE_KITS: { name: string; members: CategoryKey[] }[] = [
  // Duplicate categories are real (a kit often holds several skills of one
  // kind); they fatten that category's wave instead of printing clone bands.
  {
    name: 'Ship a web app',
    members: ['frontend', 'frontend', 'backend', 'backend', 'database', 'devops'],
  },
  { name: 'Launch content', members: ['writing', 'writing', 'writing', 'media', 'marketing'] },
  { name: 'Agent starter', members: ['agents', 'quality'] },
  {
    name: 'Founder ops',
    members: ['product', 'finance', 'sales', 'research', 'productivity', 'marketing'],
  },
  // Mixed-section kits: the multicolor story, and the weighted marks earning
  // their keep (including a perfect three-way tie on Indie hacker).
  { name: 'Indie hacker', members: ['frontend', 'marketing', 'writing'] },
  { name: 'Product studio', members: ['design', 'product', 'frontend', 'research'] },
  {
    name: 'Content engine',
    members: ['writing', 'media', 'agents', 'marketing', 'productivity'],
  },
  { name: 'Data storytelling', members: ['database', 'design', 'finance', 'media'] },
]

// ── Page ─────────────────────────────────────────────────────────────────────

export function RisoLab() {
  const [seed, setSeed] = useState(42)
  const [style, setStyle] = useState<StyleMode>('system')
  // Off by default: the drifted second pass reads as a drop shadow more than
  // a press artifact. The toggle keeps it around for comparison.
  const [misprint, setMisprint] = useState(false)
  // Default: ONE screen everywhere — Bayer 8×8 at pixel size 1, where the
  // dither reads as a fine even finish rather than a message. Per-section
  // technologies (pixels / dots / grain) survive in the select; side by side
  // the unified screen won: calmer grid, waves and marks come forward, and
  // it downscales more gracefully.
  const [glyph, setGlyph] = useState(true)
  // How the glyph reads against the pressing. knockout = today's paper cutout;
  // invert = deep-ink silhouette; burn = same-hue overprint (texture survives).
  const [glyphMode, setGlyphMode] = useState<GlyphMode>('knockout')
  // Edition-stamp placement: 'foot' tallies along the bottom; 'inside' punches
  // the count as holes in the dominant mark (a stamp inside the shape).
  const [stamp, setStamp] = useState<'foot' | 'inside'>('foot')
  const [screen, setScreen] = useState<ScreenMode>('bayer8')
  const [pixelSize, setPixelSize] = useState(1)
  const [grainIntensity, setGrainIntensity] = useState(0.35)
  const [grainScale, setGrainScale] = useState(30)

  const grain = useMemo<GrainOpts>(
    () => ({ grainIntensity, grainScale, screen, pixelSize }),
    [grainIntensity, grainScale, screen, pixelSize],
  )

  const recipes = useMemo(() => {
    const out = new Map<CategoryKey, Recipe>()
    for (const { categories } of CATEGORIES_BY_SECTION) {
      for (const cat of categories) out.set(cat.key, skillRecipe(cat, seed, grain, style))
    }
    return out
  }, [seed, grain, style])

  const kitRecipes = useMemo(
    () => SAMPLE_KITS.map((k) => kitRecipe(k.name, k.members, seed, grain)),
    [seed, grain],
  )

  const qualitySkillRecipes = useMemo(
    () =>
      SAMPLE_QUALITY_SKILLS.map((s) =>
        skillRecipe(CATEGORY_BY_KEY.quality, seed, grain, style, s.ref),
      ),
    [seed, grain, style],
  )

  return (
    <main className="mx-auto max-w-[1320px] px-6 py-12">
      <h1 className="text-2xl font-bold text-(--ink)">Cover experiments: risograph</h1>
      <p className="mt-2 max-w-3xl text-sm text-(--ink-2)">
        Every skill cover is one form, the gradation roll, printed in one screen: a fine Bayer
        dither that reads as finish, not message (per-section print technologies live in the
        Screen select). Hue alone says the section; skills are strictly one ink
        (multicolor is reserved for kits, so color count reads as content count); the skill&apos;s
        ref seeds the pressing: roll direction, shade anchors, screen cell. The glyph is printed
        into the raster, not pasted on. Kits stack one band per member (every ink on a kit is a
        member), marked with weighted section geometry. Skills on desktop keep the quiet
        production cover; only kits get the print.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border border-(--line) bg-(--surface) p-4">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setSeed(Math.floor(Math.random() * 100000))}
            className="rounded-lg bg-(--ink) px-4 py-2 text-sm font-semibold text-(--surface)"
          >
            New pressing
          </button>
        </div>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-(--ink-2)">Style</span>
          <select
            value={style}
            onChange={(e) => setStyle(e.target.value as StyleMode)}
            className="mt-1 block rounded-md border border-(--line) bg-(--surface) px-2 py-1 text-sm text-(--ink)"
          >
            <option value="system">System (one style per section)</option>
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-(--ink-2)">Screen</span>
          <select
            value={screen}
            onChange={(e) => setScreen(e.target.value as ScreenMode)}
            className="mt-1 block rounded-md border border-(--line) bg-(--surface) px-2 py-1 text-sm text-(--ink)"
          >
            <option value="section">By section (bayer / dots / grain)</option>
            <option value="grain">Riso grain</option>
            <option value="dots">Halftone dots</option>
            <option value="hatch">Engraved lines</option>
            <option value="bayer2">Bayer 2×2</option>
            <option value="bayer4">Bayer 4×4</option>
            <option value="bayer8">Bayer 8×8</option>
          </select>
        </label>
        {screen !== 'grain' && (
          <label className="block w-28">
            <span className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-wide text-(--ink-2)">Pixel size</span>
              <span className="font-mono text-xs text-(--ink-2)">{pixelSize}</span>
            </span>
            <input
              type="range"
              min={1}
              max={4}
              value={pixelSize}
              onChange={(e) => setPixelSize(+e.target.value)}
              className="mt-1 w-full"
            />
          </label>
        )}
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-(--ink-2)">Glyph fill</span>
          <select
            value={glyphMode}
            onChange={(e) => setGlyphMode(e.target.value as GlyphMode)}
            className="mt-1 block rounded-md border border-(--line) bg-(--surface) px-2 py-1 text-sm text-(--ink)"
          >
            <option value="knockout">Knockout (paper cutout)</option>
            <option value="invert">Invert (deep-ink silhouette)</option>
            <option value="burn">Burn (same-hue overprint)</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs uppercase tracking-wide text-(--ink-2)">Count stamp</span>
          <select
            value={stamp}
            onChange={(e) => setStamp(e.target.value as 'foot' | 'inside')}
            className="mt-1 block rounded-md border border-(--line) bg-(--surface) px-2 py-1 text-sm text-(--ink)"
          >
            <option value="foot">Foot (corner tally)</option>
            <option value="inside">Inside (in the shape)</option>
          </select>
        </label>
        <div className="flex items-center gap-5">
          <label className="flex items-center gap-2 text-sm text-(--ink)">
            <input type="checkbox" checked={glyph} onChange={(e) => setGlyph(e.target.checked)} />
            Glyph
          </label>
          <label className="flex items-center gap-2 text-sm text-(--ink)">
            <input
              type="checkbox"
              checked={misprint}
              onChange={(e) => setMisprint(e.target.checked)}
            />
            Misprint pass
          </label>
        </div>
        <label className="block w-40">
          <span className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wide text-(--ink-2)">Grain</span>
            <span className="font-mono text-xs text-(--ink-2)">{grainIntensity.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={5}
            max={80}
            value={Math.round(grainIntensity * 100)}
            onChange={(e) => setGrainIntensity(+e.target.value / 100)}
            className="mt-1 w-full"
          />
        </label>
        <label className="block w-40">
          <span className="flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wide text-(--ink-2)">Grain scale</span>
            <span className="font-mono text-xs text-(--ink-2)">{grainScale}</span>
          </span>
          <input
            type="range"
            min={5}
            max={100}
            value={grainScale}
            onChange={(e) => setGrainScale(+e.target.value)}
            className="mt-1 w-full"
          />
        </label>
      </div>

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-(--ink-2)">Kits</h2>
        <p className="mt-1 text-sm text-(--ink-2)">
          A kit is the skill roll stacked into category waves, each wave&apos;s thickness
          proportional to how many skills of that category the kit holds, printed in the
          dominant section&apos;s screen. Three frontend skills print one fat teal wave.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {SAMPLE_KITS.map((kit, i) => (
            <div key={kit.name} className="rounded-xl border border-(--line) bg-(--surface) p-4">
              <KitCover
                members={kit.members}
                recipe={kitRecipes[i]}
                size={200}
                misprint={misprint}
                glyph={glyph}
                glyphMode={glyphMode}
                stamp={stamp}
              />
              <p className="mt-3 text-sm font-semibold text-(--ink)">{kit.name}</p>
              <p className="font-mono text-xs text-(--ink-2)">{kitRecipes[i].note}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-(--ink-2)">
          Desktop context
        </h2>
        <p className="mt-1 text-sm text-(--ink-2)">
          The Latest list as-is, except kits. Skills keep the production cover; the riso print
          marks the kits as the bigger objects in the list.
        </p>
        <div className="mt-4">
          <TrayContext
            kitRecipes={kitRecipes}
            misprint={misprint}
            glyphMode={glyphMode}
            stamp={stamp}
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-(--ink-2)">
          One category, five skills
        </h2>
        <p className="mt-1 text-sm text-(--ink-2)">
          All Code Review: same ink, same glyph. Each skill&apos;s ref seeds its own pressing
          (roll direction, shade anchors, screen cell), so a category row never clones without
          any cover getting busier.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {SAMPLE_QUALITY_SKILLS.map((s, i) => (
            <div key={s.ref} className="rounded-xl border border-(--line) bg-(--surface) p-4">
              <SkillCover
                cat={CATEGORY_BY_KEY.quality}
                recipe={qualitySkillRecipes[i]}
                size={176}
                misprint={misprint}
                glyph={glyph}
                glyphMode={glyphMode}
              />
              <p className="mt-3 truncate text-sm font-semibold text-(--ink)">
                {s.ref.split('/')[1]}
              </p>
              <p className="font-mono text-xs text-(--ink-2)">
                {qualitySkillRecipes[i].note}
              </p>
            </div>
          ))}
        </div>
      </section>

      {CATEGORIES_BY_SECTION.map(({ section, categories }) => (
        <section key={section} className="mt-10">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-(--ink-2)">
            {SECTION_LABEL[section]} · skills, web sizes only
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {categories.map((cat) => {
              const recipe = recipes.get(cat.key)
              if (!recipe) return null
              return (
                <div
                  key={cat.key}
                  className="rounded-xl border border-(--line) bg-(--surface) p-4"
                >
                  <SkillCover
                    cat={cat}
                    recipe={recipe}
                    size={176}
                    misprint={misprint}
                    glyph={glyph}
                    glyphMode={glyphMode}
                  />
                  <p className="mt-3 text-sm font-semibold text-(--ink)">{cat.label}</p>
                  <p className="font-mono text-xs text-(--ink-2)">{recipe.note}</p>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <section className="mt-10">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-(--ink-2)">
          Legibility at list sizes
        </h2>
        <p className="mt-1 text-sm text-(--ink-2)">
          Kits are the ones that have to survive small: the print has to read as a color and a
          texture, not noise. Skills at these sizes keep the production cover, so only kits are
          shown.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-6 rounded-xl border border-(--line) bg-(--surface) p-4">
          {SAMPLE_KITS.map((kit, i) => (
            <div key={kit.name} className="flex items-end gap-3">
              {[96, 64, 40, 28].map((s) => (
                <div key={s} className="flex flex-col items-center gap-1">
                  <KitCover
                    members={kit.members}
                    recipe={kitRecipes[i]}
                    size={s}
                    misprint={misprint}
                    glyph={glyph}
                    glyphMode={glyphMode}
                    stamp={stamp}
                  />
                  <span className="text-xs text-(--ink-2)">{s}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </main>
  )
}
