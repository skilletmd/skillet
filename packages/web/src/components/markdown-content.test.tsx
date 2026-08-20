import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MarkdownContent } from './markdown-content'
import { SkillDocumentView } from './skill-document-view'
import { bundleImageResolver, type SkillBundleAssets } from '@/lib/bundle-images'
import { MAX_INLINE_IMAGE_BYTES } from '@skillet/protocol/inline-images'

afterEach(cleanup)

const HASH = `sha256:${'a'.repeat(64)}`
const ASSETS: SkillBundleAssets = {
  author: 'louisedesadeleer',
  slug: 'clipify',
  versionHash: HASH,
  sizes: {
    'SKILL.md': 40,
    'README.md': 80,
    'assets/preview.png': 1234,
    'assets/logo.svg': 90,
    'assets/huge.png': MAX_INLINE_IMAGE_BYTES + 1,
    'docs/GUIDE.md': 60,
    'docs/img/shot.png': 456,
  },
}
const FILES_ROUTE = `/api/registry/api/v1/skills/louisedesadeleer/clipify/versions/${encodeURIComponent(HASH)}/files`

function renderMd(content: string, renderedPath = 'README.md') {
  return render(
    <MarkdownContent content={content} resolveImageSrc={bundleImageResolver(ASSETS, renderedPath)} />,
  )
}

describe('MarkdownContent bundle image resolution', () => {
  it('renders a bundle-relative image through the proxy files route (AE1)', () => {
    renderMd('![preview](assets/preview.png)')
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', `${FILES_ROUTE}/assets/preview.png`)
    expect(img).toHaveAttribute('alt', 'preview')
    expect(img).toHaveAttribute('loading', 'lazy')
  })

  it("resolves ./ against the rendered file's own directory, not the bundle root (AE2)", () => {
    renderMd('![shot](./img/shot.png)', 'docs/GUIDE.md')
    expect(screen.getByRole('img')).toHaveAttribute('src', `${FILES_ROUTE}/docs/img/shot.png`)
  })

  it('renders nothing when the directory-resolved path is not in the bundle (AE2)', () => {
    // Only docs/img/shot.png exists; from README.md at the root, ./img/shot.png
    // would be root-level img/shot.png — absent.
    renderMd('![shot](./img/shot.png)', 'README.md')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders nothing for a reference that is not in the bundle (AE4)', () => {
    renderMd('![missing](assets/missing.png)')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders nothing for an .svg even when it exists in the bundle (R6)', () => {
    renderMd('![logo](assets/logo.svg)')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('passes an absolute https src through untouched', () => {
    renderMd('![ext](https://example.com/x.png)')
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/x.png')
  })

  it('renders nothing for a traversal src that escapes the bundle', () => {
    renderMd('![evil](../../../etc/passwd.png)')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('renders nothing for an image over the inline size cap — no request issued', () => {
    renderMd('![huge](assets/huge.png)')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('unmounts the element when the emitted image fails to load (R2)', () => {
    renderMd('![preview](assets/preview.png)')
    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('without a resolver prop, relative srcs render exactly as before (blog surface)', () => {
    render(<MarkdownContent content="![preview](assets/preview.png)" />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'assets/preview.png')
  })
})

describe('MarkdownContent raw HTML handling', () => {
  it('drops HTML comments instead of rendering them as literal text', () => {
    render(
      <MarkdownContent content={'<!-- AUTO-GENERATED — do not edit -->\n<!-- Regenerate: bun run gen -->\n\n# Title\n'} />,
    )
    expect(screen.getByText('Title')).toBeInTheDocument()
    expect(screen.queryByText(/AUTO-GENERATED/)).not.toBeInTheDocument()
    expect(screen.queryByText(/<!--/)).not.toBeInTheDocument()
  })

  it('drops inline raw HTML tags but keeps the surrounding prose', () => {
    render(<MarkdownContent content={'before <img src="x.png"> after\n'} />)
    expect(screen.getByText(/before\s+after/)).toBeInTheDocument()
    expect(screen.queryByText(/<img/)).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('still renders author-escaped angle brackets as text', () => {
    render(<MarkdownContent content={'use &lt;div&gt; sparingly\n'} />)
    expect(screen.getByText('use <div> sparingly')).toBeInTheDocument()
  })
})

describe('SkillDocumentView (single-file skill) image resolution', () => {
  it('never shows a broken image for a relative ref that cannot resolve', () => {
    // A single-file bundle has no image files, so the ref renders nothing.
    const assets: SkillBundleAssets = {
      author: 'a',
      slug: 's',
      versionHash: HASH,
      sizes: { 'SKILL.md': 40 },
    }
    render(
      <SkillDocumentView
        source="![preview](assets/preview.png)"
        author="a"
        slug="s"
        assets={assets}
      />,
    )
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
