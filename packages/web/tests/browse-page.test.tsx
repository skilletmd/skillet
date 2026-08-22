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

describe('browse byline avatars', () => {
  // Browse cards used to hardcode makerAvatarUrl={null} and fall back to an
  // identicon for everyone, because resolving a face meant a people-catalog
  // fan-out per card. The avatar now rides along on the catalog row itself
  // (author_avatar_url / owner_avatar_url), so the null must not come back.
  it('passes real avatars through to skill and kit cards', () => {
    const surface = readFileSync(
      resolve(process.cwd(), 'src/app/(consumer)/skills/explore-surface.tsx'),
      'utf8',
    )
    expect(surface).not.toContain('makerAvatarUrl={null}')
    expect(surface).toContain('makerAvatarUrl={row.skill.author_avatar_url ?? null}')
    expect(surface).toContain('makerAvatarUrl={row.kit.ownerAvatarUrl}')
  })

  it('maps the wire fields the cards depend on', () => {
    const catalog = readFileSync(resolve(process.cwd(), 'src/lib/registry-catalog.ts'), 'utf8')
    expect(catalog).toContain('ownerAvatarUrl')
    expect(catalog).toContain('owner_avatar_url')
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
