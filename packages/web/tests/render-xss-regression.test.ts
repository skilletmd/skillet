import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// The skill VIEW path renders markdown via react-markdown WITHOUT rehype-raw, so
// raw HTML in a SKILL.md is escaped to inert text, never executed. This guards
// against a future regression (e.g. someone adding rehype-raw). The editor path
// (marked + DOMPurify) is covered by skill-markdown-editor-sanitize.test.ts.
function renderMarkdown(md: string): string {
  return renderToStaticMarkup(
    createElement(ReactMarkdown, { remarkPlugins: [remarkGfm] }, md),
  )
}

describe('skill view markdown path (react-markdown, no rehype-raw)', () => {
  it('does not emit a live <img onerror> tag from raw HTML', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)>')
    expect(out).not.toMatch(/<img[^>]*onerror/i)
    expect(out).not.toContain('<img')
    // The raw HTML is present only as escaped, inert text.
    expect(out).toContain('&lt;img')
  })

  it('does not emit a live <script> tag', () => {
    const out = renderMarkdown('before<script>alert(1)</script>after')
    expect(out).not.toContain('<script')
    expect(out).toContain('&lt;script')
  })

  it('does not emit an <svg onload> tag', () => {
    const out = renderMarkdown('<svg onload=alert(1)></svg>')
    expect(out).not.toMatch(/<svg[^>]*onload/i)
  })

  it('still renders legitimate markdown as real elements', () => {
    const out = renderMarkdown('# Title\n\n**bold** and `code`\n\n- one\n- two')
    expect(out).toMatch(/<h1[^>]*>Title<\/h1>/)
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<code>code</code>')
    expect(out).toContain('<li>one</li>')
  })
})
