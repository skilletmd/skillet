import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isCategoryKey } from '@/lib/categories'

describe('browse featured', () => {
  // /browse is Featured; /browse/all is the full grid. Both rely on static routes
  // winning over /browse/[category], so 'all' and 'featured' must never become real
  // category slugs.
  it('keeps "all" and "featured" out of the category enum', () => {
    expect(isCategoryKey('all')).toBe(false)
    expect(isCategoryKey('featured')).toBe(false)
  })

  it('serves Featured at /browse and the grid at /browse/all', () => {
    const browse = readFileSync(
      resolve(process.cwd(), 'src/app/(consumer)/browse/page.tsx'),
      'utf8',
    )
    const all = readFileSync(
      resolve(process.cwd(), 'src/app/(consumer)/browse/all/page.tsx'),
      'utf8',
    )
    expect(browse).toContain('HomeCatalogShelves')
    expect(all).toContain('BrowseGrid')
  })
})

describe('browse page', () => {
  it('does not export force-dynamic', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(consumer)/browse/page.tsx'),
      'utf8',
    )
    const categoryPage = readFileSync(
      resolve(process.cwd(), 'src/app/(consumer)/browse/[category]/page.tsx'),
      'utf8',
    )
    expect(page).not.toContain("dynamic = 'force-dynamic'")
    expect(categoryPage).not.toContain("dynamic = 'force-dynamic'")
  })

  it('streams the catalog grid behind in-page Suspense', () => {
    const view = readFileSync(
      resolve(process.cwd(), 'src/app/(consumer)/browse/browse-view.tsx'),
      'utf8',
    )
    expect(view).toContain('Suspense')
    expect(view).toContain('BrowseGridSkeleton')
  })
})

describe('feed page', () => {
  it('opts into per-request rendering via markDynamicRoute', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(consumer)/(activity)/feed/page.tsx'),
      'utf8',
    )
    // The shared activity shell marks the route dynamic at render time.
    const shell = readFileSync(
      resolve(process.cwd(), 'src/app/(consumer)/(activity)/activity-shell.tsx'),
      'utf8',
    )
    expect(page).not.toContain("dynamic = 'force-dynamic'")
    expect(shell).toContain('markDynamicRoute')
  })

  it('streams the timeline behind a dynamic Suspense boundary', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(consumer)/(activity)/feed/page.tsx'),
      'utf8',
    )
    expect(page).toContain('DynamicPageBoundary')
    expect(page).toContain('FeedBodySkeleton')
    expect(page).not.toMatch(/feed\/loading/)
  })
})

describe('skill page', () => {
  it('does not export force-dynamic or route revalidate', () => {
    const page = readFileSync(
      resolve(process.cwd(), 'src/app/(consumer)/[author]/[skill]/page.tsx'),
      'utf8',
    )
    expect(page).not.toContain("dynamic = 'force-dynamic'")
    expect(page).not.toContain('revalidate =')
    expect(page).not.toContain('dynamicParams =')
  })
})
