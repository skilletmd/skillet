import { describe, it, expect } from 'vitest'
import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'

// Mirrors markdownToEditorHtml() in skill-markdown-editor.tsx — the value that is
// assigned to innerHTML. The component function isn't exported, so we exercise the
// exact same marked+DOMPurify pipeline here to prove the XSS sinks are closed.
function markdownToEditorHtml(markdown: string): string {
  const html = marked.parse(markdown || '', { async: false }) as string
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}

describe('skill markdown editor sanitization (finding 5)', () => {
  it('strips an <img onerror=…> payload', () => {
    const out = markdownToEditorHtml('<img src=x onerror=alert(1)>')
    expect(out).not.toMatch(/onerror/i)
    expect(out).not.toMatch(/alert\(1\)/)
  })

  it('strips SVG/image event-handler payloads', () => {
    const out = markdownToEditorHtml('<svg onload=alert(1)></svg><image href=x onerror=alert(2)>')
    expect(out).not.toMatch(/onload/i)
    expect(out).not.toMatch(/onerror/i)
  })

  it('neutralizes javascript: links', () => {
    const out = markdownToEditorHtml('[click](javascript:alert(1))')
    expect(out).not.toMatch(/javascript:/i)
  })

  it('removes <script> tags', () => {
    const out = markdownToEditorHtml('before<script>alert(1)</script>after')
    expect(out).not.toMatch(/<script/i)
  })

  it('preserves legitimate markdown formatting', () => {
    const out = markdownToEditorHtml('# Title\n\n**bold** and `code`\n\n- one\n- two\n\n[link](https://example.com)')
    expect(out).toMatch(/<h1[^>]*>Title<\/h1>/)
    expect(out).toMatch(/<strong>bold<\/strong>/)
    expect(out).toMatch(/<code>code<\/code>/)
    expect(out).toMatch(/<li>one<\/li>/)
    expect(out).toMatch(/href="https:\/\/example\.com"/)
  })

  it('handles empty input without error', () => {
    expect(markdownToEditorHtml('')).toBe('')
  })
})
