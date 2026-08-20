import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  coverSvg,
  categoryCoverSvg,
  CATEGORY_GLYPHS,
  isUncategorizedSingle,
  UNCATEGORIZED_HUE,
} from '../src/covers.js'

// The section shape for a single skill: Code □ (rect), Grow △ (polygon),
// Create ○ (filled circle). An uncategorized single skill must render NONE of these.
const hasCategoryShape = (svg: string): boolean =>
  svg.includes('<polygon') ||
  svg.includes('<rect x="30') ||
  /<circle[^>]+fill="hsl/.test(svg)

describe('isUncategorizedSingle', () => {
  it('is true for a single skill with a null category', () => {
    assert.equal(isUncategorizedSingle([null]), true)
  })

  it('is true for empty input (no category at all)', () => {
    assert.equal(isUncategorizedSingle([]), true)
  })

  it('is true for a single unknown/invalid category string', () => {
    assert.equal(isUncategorizedSingle(['not-a-real-category']), true)
  })

  it('is false for a single valid category', () => {
    assert.equal(isUncategorizedSingle(['research']), false)
  })

  it('is false for a kit (multiple members), even all-null', () => {
    assert.equal(isUncategorizedSingle([null, null]), false)
    assert.equal(isUncategorizedSingle(['research', null]), false)
  })
})

describe('coverSvg — uncategorized single skill', () => {
  it('renders a neutral ground with no section shape', () => {
    const svg = coverSvg('k-dense-ai/biopython', [null])
    assert.ok(!hasCategoryShape(svg), 'no fabricated section shape')
    assert.ok(svg.includes(`hsl(${UNCATEGORIZED_HUE}`), 'uses the neutral hue')
  })

  it('does not fabricate a category shape for an invalid category string', () => {
    const svg = coverSvg('some/seed', ['bogus'])
    assert.ok(!hasCategoryShape(svg))
  })
})

describe('coverSvg — uncategorized list mark', () => {
  it('listMark adds a dashed neutral placeholder, not a category shape', () => {
    const svg = coverSvg('acme/demo', [null], { listMark: true })
    assert.ok(!hasCategoryShape(svg), 'no fabricated section shape')
    assert.ok(svg.includes('stroke-dasharray'), 'visible neutral list mark')
  })

  it('default uncategorized (hero) stays ground-only with no list mark', () => {
    const svg = coverSvg('acme/demo', [null])
    assert.ok(!hasCategoryShape(svg))
    assert.ok(!svg.includes('stroke-dasharray'))
  })
})

describe('coverSvg — categorized single skill (app-icon cover)', () => {
  it('renders the squircle-gradient + glyph, not a section shape', () => {
    const svg = coverSvg('acme/demo', ['research'])
    assert.ok(!hasCategoryShape(svg), 'no old section shape')
    assert.ok(svg.includes('linearGradient'), 'gradient ground')
    assert.ok(svg.includes('translate(34.8 34.8)'), 'centered glyph group')
    assert.ok(!svg.includes(`hsl(${UNCATEGORIZED_HUE} 8%`), 'not the neutral ground')
  })

  it('is deterministic — same seed + category → identical SVG', () => {
    assert.equal(coverSvg('acme/demo', ['research']), coverSvg('acme/demo', ['research']))
  })

  it('groundOnly renders the squircle ground with no glyph', () => {
    const svg = coverSvg('acme/demo', ['research'], { groundOnly: true })
    assert.ok(svg.includes('linearGradient'), 'still has the ground')
    assert.ok(!svg.includes('translate(34.8 34.8)'), 'no glyph group')
  })
})

describe('categoryCoverSvg', () => {
  it('renders a squircle + glyph for every category', () => {
    for (const key of Object.keys(CATEGORY_GLYPHS) as (keyof typeof CATEGORY_GLYPHS)[]) {
      const svg = categoryCoverSvg(key)
      assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'), `${key}: valid svg`)
      assert.ok(svg.includes('translate(34.8 34.8)'), `${key}: has centered glyph`)
      assert.ok(CATEGORY_GLYPHS[key].length > 0, `${key}: non-empty glyph`)
    }
  })

  it('preserves filled multi-primitive glyphs (no single-path collapse)', () => {
    assert.ok(categoryCoverSvg('database').includes('<ellipse'), 'database keeps its ellipse')
    assert.ok(
      categoryCoverSvg('media').includes('M6.5 5.75 10.75 8 6.5 10.25z'),
      'media keeps its filled play triangle',
    )
    // Design has four filled dots carrying their own fill/stroke override.
    const design = categoryCoverSvg('design')
    assert.ok(
      (design.match(/fill="currentColor" stroke="none"/g) ?? []).length >= 4,
      'design keeps its filled palette dots',
    )
  })

  it('uses the category hue and light gradient by default', () => {
    // research hue from CATEGORY_SWATCHES; assert the gradient carries it.
    const svg = categoryCoverSvg('research')
    assert.match(svg, /hsl\(\d+ 44% 88%\)/, 'light gradient top stop')
    assert.match(svg, /hsl\(\d+ 40% 80%\)/, 'light gradient bottom stop')
  })

  it('dark mode uses a two-stop dark gradient distinct from light', () => {
    const light = categoryCoverSvg('research', { dark: false })
    const dark = categoryCoverSvg('research', { dark: true })
    assert.notEqual(light, dark)
    assert.match(dark, /hsl\(\d+ 30% 27%\)/, 'dark gradient top stop')
    assert.match(dark, /hsl\(\d+ 26% 21%\)/, 'dark gradient bottom stop (distinct lightness)')
  })

  it('is a plain SVG string — no framework/node artifacts', () => {
    const svg = categoryCoverSvg('agents')
    assert.ok(!svg.includes('React') && !svg.includes('node:'))
  })
})

describe('coverSvg — kit', () => {
  it('a multi-category kit is a flat dominant-hue ground — no bands, no marks', () => {
    // The painted canvas print is the visible kit cover; this instant SVG is only
    // the underlay/ground, so it paints a plain tint, not gradient bands or marks.
    const svg = coverSvg('acme/kit', ['research', 'frontend', 'design'])
    assert.ok(!svg.includes('linearGradient'), 'no gradient bands')
    assert.ok(!svg.includes('<polygon') && !svg.includes('<circle'), 'no section marks')
    assert.match(svg, /<rect [^>]*fill="hsl\(\d/, 'a single hsl ground rect')
  })

  it('is deterministic and theme-aware', () => {
    const light = coverSvg('acme/kit', ['research', 'frontend'])
    assert.equal(light, coverSvg('acme/kit', ['research', 'frontend']), 'stable per seed')
    assert.notEqual(light, coverSvg('acme/kit', ['research', 'frontend'], { dark: true }))
  })

  it('multi-member all-null input keeps a decorative seed fallback (not neutralized)', () => {
    // A kit (>1 member) is never treated as uncategorized-single. All-null input
    // collapses via resolveCats to a single seed fallback category, so it renders
    // the decorative single-skill glyph cover — acceptable (R5), just not neutral.
    // (Real kits pass one seedCategory per member, so they render the kit ground.)
    const svg = coverSvg('acme/kit', [null, null, null])
    assert.ok(svg.includes('translate(34.8 34.8)'), 'decorative glyph fallback, not blank')
    assert.ok(!svg.includes(`hsl(${UNCATEGORIZED_HUE} 22%`), 'not the neutral ground')
  })
})
