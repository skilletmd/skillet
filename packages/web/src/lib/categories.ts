/**
 * The closed skill taxonomy and its color system. Categories are *jobs*, not
 * frameworks (framework specificity lives in tags). One primary category per
 * skill drives its color and its main browse bucket.
 *
 * Color is grouped into three primary families whose hue *means* the section:
 * Code = blue (indigo → sky), Grow = green (racing → light), Create = red (red
 * → pink). A category reads as its family at a glance while sitting at its own
 * spot in the band. The per-skill mark varies lightness off the ref hash, so two
 * skills in one category are the same family, not clones.
 */
import { CATEGORY_SWATCHES, type CategoryKey, type CategorySection } from '@skillet/protocol/covers'

// The category keys, their sections, and their computed colors are owned by the
// shared cover engine (@skillet/protocol/covers) so web + desktop never drift.
// This module layers the browse metadata (labels, groups, blurbs) on top.
export type { CategoryKey, CategorySection }

export interface Category {
  key: CategoryKey
  label: string
  /** Family grouping, used for the browse layout and to keep hues clustered. */
  group: 'Engineering' | 'Quality' | 'AI & Agents' | 'Design' | 'Product & GTM' | 'Business & Ops'
  /** Top-level section header in the browse rail. */
  section: CategorySection
  blurb: string
  /** Base HSL hue (0–360). Marks/hero washes derive from this. */
  hue: number
  /** Swatch saturation (%). Swept across the band with hue + lightness. */
  sat: number
  /** Swatch lightness (%). Deep/dark at the band start → light at the end, so a
   *  section reads as a depth sweep (racing green → light green), not flat. */
  light: number
}

// Category definitions, without color. The `group` still records the conceptual
// family (used elsewhere), but the dot HUE is assigned below by alphabetical
// position — so the alphabetical browse list reads as a smooth spectrum sweep
// while each category keeps one stable, recognizable color.
const CATEGORY_DEFS: Omit<Category, 'hue' | 'sat' | 'light'>[] = [
  {
    key: 'frontend',
    label: 'Frontend',
    group: 'Engineering',
    section: 'Code',
    blurb: 'React, components, Next.js, browser UI.',
  },
  {
    key: 'mobile',
    label: 'Mobile',
    group: 'Engineering',
    section: 'Code',
    blurb: 'iOS, Android, React Native, Expo.',
  },
  {
    key: 'backend',
    label: 'Backend',
    group: 'Engineering',
    section: 'Code',
    blurb: 'Services, endpoints, auth, integrations.',
  },
  {
    key: 'database',
    label: 'Data',
    group: 'Engineering',
    section: 'Code',
    blurb: 'SQL, schemas, migrations, analytics.',
  },
  {
    key: 'devops',
    label: 'DevOps',
    group: 'Engineering',
    section: 'Code',
    blurb: 'Deploy, CI/CD, containers, incidents.',
  },
  {
    key: 'security',
    label: 'Security',
    group: 'Engineering',
    section: 'Code',
    blurb: 'Audits, threat modeling, secrets, compliance, bot protection.',
  },
  {
    key: 'quality',
    label: 'Code Review',
    group: 'Quality',
    section: 'Code',
    blurb: 'Code review, testing, standards, and coverage: correctness across any stack.',
  },
  {
    key: 'agents',
    label: 'AI',
    group: 'AI & Agents',
    section: 'Code',
    blurb: 'Building with LLMs: agents, RAG, prompts, evals, and skill authoring.',
  },
  {
    key: 'design',
    label: 'Design',
    group: 'Design',
    section: 'Create',
    blurb: 'Visual design, image generation, critique, design tokens, prototyping.',
  },
  {
    key: 'product',
    label: 'Strategy',
    group: 'Product & GTM',
    section: 'Grow',
    blurb: 'Roadmaps, PRDs, prioritization, and launch planning.',
  },
  {
    key: 'research',
    label: 'Research',
    group: 'Product & GTM',
    section: 'Grow',
    blurb: 'Deep research, web research, market and competitive analysis, synthesis.',
  },
  {
    key: 'writing',
    label: 'Writing',
    group: 'Product & GTM',
    section: 'Create',
    blurb: 'Long-form, scripts, editing, docs, and technical writing: craft, not campaigns.',
  },
  {
    key: 'marketing',
    label: 'Marketing',
    group: 'Product & GTM',
    section: 'Grow',
    blurb: 'Social posts, blog posts, copy, email, SEO, ads, and campaigns.',
  },
  {
    key: 'sales',
    label: 'Sales',
    group: 'Product & GTM',
    section: 'Grow',
    blurb: 'Outbound, cold email, discovery, account research, CRM.',
  },
  {
    key: 'finance',
    label: 'Finance',
    group: 'Business & Ops',
    section: 'Grow',
    blurb: 'Modeling, accounting, invoicing, fintech.',
  },
  {
    key: 'productivity',
    label: 'Productivity',
    group: 'Business & Ops',
    section: 'Grow',
    blurb: 'Email, calendar, notes, meetings, and personal automation.',
  },
  {
    key: 'media',
    label: 'Media',
    group: 'Design',
    section: 'Create',
    blurb: 'Video generation and editing, motion graphics, music, and audio.',
  },
]

/** Display order of the three browse sections. */
export const CATEGORY_SECTIONS: CategorySection[] = ['Code', 'Create', 'Grow']

/** Header text shown in the browse rail. The internal section key stays 'Create'
 * (it drives cover-art shape/color); only the label reads "Creative" so it isn't
 * confused with the global Create action. */
export const SECTION_LABEL: Record<CategorySection, string> = {
  Code: 'Code',
  Create: 'Creative',
  Grow: 'Grow',
}

/** One representative color per section for tinting category glyphs (the browse
 *  rail, skill About rows — anywhere a glyph should read as its section family
 *  rather than a per-category swatch). Mid-band tones tuned for even contrast on
 *  the cream surfaces, so no category washes out. */
export const SECTION_GLYPH_COLOR: Record<CategorySection, string> = {
  Code: 'hsl(190 45% 42%)',
  Create: 'hsl(8 52% 53%)',
  Grow: 'hsl(126 38% 39%)',
}

/** URL slug for a section landing (/browse/<slug>). Lowercased label so the path
 *  reads how the header does — 'creative', not the internal 'Create' key. Slugs
 *  never collide with a category key (no category is named code/creative/grow),
 *  so a section rides the same /browse/[segment] route as a category. */
export const SECTION_SLUG: Record<CategorySection, string> = {
  Code: 'code',
  Create: 'creative',
  Grow: 'grow',
}

const SECTION_BY_SLUG: Record<string, CategorySection> = Object.fromEntries(
  CATEGORY_SECTIONS.map((s) => [SECTION_SLUG[s], s]),
)

/** A one-line description of a section for its landing-page SEO metadata. */
export const SECTION_BLURB: Record<CategorySection, string> = {
  Code: 'Frontend, backend, data, DevOps, security, code review, and AI engineering.',
  Create: 'Design, media, and writing: the craft skills.',
  Grow: 'Product, marketing, sales, research, finance, and productivity.',
}

export function isSectionSlug(value: string | null | undefined): value is string {
  return value != null && value in SECTION_BY_SLUG
}

/** The section a landing slug points at, or null when it isn't a section slug. */
export function sectionFromSlug(slug: string | null | undefined): CategorySection | null {
  return slug != null ? (SECTION_BY_SLUG[slug] ?? null) : null
}

/** The category keys that make up a section — the set a section landing filters
 *  to (Creative → design, media, writing). */
export function categoryKeysForSection(section: CategorySection): CategoryKey[] {
  return CATEGORIES.filter((c) => c.section === section).map((c) => c.key)
}

// The swatch colors (the "Oasis" palette — teal Code, clay-rose Create,
// sage-green Grow, each sweeping a deep→light band alphabetically) are computed
// once in @skillet/protocol/covers and imported as CATEGORY_SWATCHES, so the
// browse dots/chips and the cover art are guaranteed to match. This module only
// merges the browse metadata (label/group/blurb) with those shared colors.
export const CATEGORIES: Category[] = CATEGORY_DEFS.map((c) => ({
  ...c,
  ...CATEGORY_SWATCHES[c.key],
}))

/** The full swatch color for a category — hue, saturation, AND lightness, so the
 *  depth sweep (deep indigo, racing green, deep red) shows on every dot/chip. */
export function swatchHsl(c: Pick<Category, 'hue' | 'sat' | 'light'>): string {
  return `hsl(${c.hue} ${c.sat}% ${c.light}%)`
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

/** Adapt a swatch's TONE (not hue) for the active theme. Bands are tuned for the
 *  cream light background; on near-black the deep ends of each sweep go invisible,
 *  so dark mode lifts the lightness FLOOR (and trims a little saturation) to keep
 *  every dot readable while preserving the family's hue and most of its range. */
export function swatchForTheme<T extends Pick<Category, 'hue' | 'sat' | 'light'>>(
  c: T,
  theme: 'light' | 'dark',
): T {
  if (theme === 'light') return c
  return {
    ...c,
    sat: clamp(c.sat - 6, 22, 90),
    light: clamp(Math.max(c.light, 48) + 6, 0, 80),
  }
}

export const CATEGORY_BY_KEY: Record<CategoryKey, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [c.key, c]),
) as Record<CategoryKey, Category>

/** Categories grouped under each section, alphabetical within a section. */
export const CATEGORIES_BY_SECTION: { section: CategorySection; categories: Category[] }[] =
  CATEGORY_SECTIONS.map((section) => ({
    section,
    categories: CATEGORIES.filter((c) => c.section === section).sort((a, b) =>
      a.label.localeCompare(b.label),
    ),
  }))

export function isCategoryKey(value: string | null | undefined): value is CategoryKey {
  return value != null && value in CATEGORY_BY_KEY
}

/** The base hue for a category, or null when uncategorized (falls back to a
 *  hash hue so marks still vary). */
export function categoryHue(key: string | null | undefined): number | null {
  return isCategoryKey(key) ? CATEGORY_BY_KEY[key].hue : null
}

/** Cover lightness bias for a category, so a cover carries the same depth as its
 *  swatch: deep categories (racing green, indigo, deep red) push their covers
 *  darker, light ones lift them. Compressed off the swatch lightness so covers
 *  stay vivid and never go murky. 0 when uncategorized. */
export function categoryTone(key: string | null | undefined): number {
  return isCategoryKey(key) ? Math.round((CATEGORY_BY_KEY[key].light - 47) * 0.6) : 0
}
