import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { FileDiff } from './file-diff'
import type { ProposalFileDiff } from '@/lib/types'

// The component lazy-loads the markdown renderer via next/dynamic; swap the
// dynamic wrapper for the (only) real target module so the preview renders
// synchronously in jsdom — with the real react-markdown pipeline, which the
// XSS test below depends on.
vi.mock('next/dynamic', async () => {
  const MarkdownPreview = (await import('@/components/notifications/markdown-preview')).default
  return { default: () => MarkdownPreview }
})

afterEach(cleanup)

function fd(overrides: Partial<ProposalFileDiff> = {}): ProposalFileDiff {
  return {
    path: 'SKILL.md',
    status: 'modified',
    binary: false,
    diff: ['@@ -1,2 +1,3 @@', ' intro', '-old line', '+new line', '+extra line'].join('\n'),
    ...overrides,
  }
}

describe('FileDiff', () => {
  it('shows filename headers for multi-file diffs, none for a single file', () => {
    const { unmount } = render(
      <FileDiff files={[fd(), fd({ path: 'scripts/run.sh', diff: '+set -e' })]} />,
    )
    expect(screen.getByRole('button', { name: /SKILL\.md/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /scripts\/run\.sh/ })).toBeInTheDocument()
    unmount()

    render(<FileDiff files={[fd()]} />)
    expect(screen.queryByText('SKILL.md')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders an added markdown file as content with an Added badge, frontmatter stripped', () => {
    const diff = [
      '--- /dev/null',
      '+++ b/SKILL.md',
      '@@ -0,0 +1,5 @@',
      '+---',
      '+name: deploy-ritual',
      '+---',
      '+# Deploy ritual',
      '+Run the checks first.',
    ].join('\n')
    render(<FileDiff files={[fd({ status: 'added', diff })]} />)
    expect(screen.getByRole('heading', { name: 'Deploy ritual' })).toBeInTheDocument()
    expect(screen.getByText('Added')).toBeInTheDocument()
    expect(screen.queryByText(/name: deploy-ritual/)).not.toBeInTheDocument()
  })

  it('styles add/delete lines and strips the +/- markers from the copyable text', () => {
    render(<FileDiff files={[fd()]} />)
    // Markers never appear in the selectable line text.
    expect(screen.queryByText('+new line')).not.toBeInTheDocument()
    expect(screen.queryByText('-old line')).not.toBeInTheDocument()
    const add = screen.getByText('new line')
    const del = screen.getByText('old line')
    expect(add.textContent).toBe('new line')
    expect(add.closest('div')?.className).toContain('bg-(--success-bg)')
    expect(del.className).toContain('line-through')
    expect(del.closest('div')?.className).toContain('bg-(--danger-bg)')
  })

  it('carries add/delete meaning in an aria-hidden, unselectable gutter glyph', () => {
    render(<FileDiff files={[fd()]} />)
    const addGutter = screen.getByText('new line').previousElementSibling
    const delGutter = screen.getByText('old line').previousElementSibling
    expect(addGutter?.textContent).toBe('+')
    expect(delGutter?.textContent).toBe('−')
    for (const gutter of [addGutter, delGutter]) {
      expect(gutter).toHaveAttribute('aria-hidden', 'true')
      expect(gutter?.className).toContain('select-none')
    }
  })

  it('renders a single "No changes." line for an empty diff — no count header', () => {
    render(<FileDiff files={[fd({ status: 'unchanged', diff: null })]} />)
    expect(screen.getByText('No changes.')).toBeInTheDocument()
    expect(screen.queryByText(/file(s)? changed/)).not.toBeInTheDocument()
  })

  it('falls back for binary files and null diffs', () => {
    const { unmount } = render(<FileDiff files={[fd({ binary: true, diff: null })]} />)
    expect(screen.getByText('Binary file. No preview.')).toBeInTheDocument()
    unmount()

    render(<FileDiff files={[fd({ diff: null })]} />)
    expect(screen.getByText('No text changes.')).toBeInTheDocument()
  })

  it('toggles per-file expand/collapse via aria-expanded', () => {
    render(<FileDiff files={[fd(), fd({ path: 'scripts/run.sh', diff: '+set -e' })]} />)
    const toggle = screen.getByRole('button', { name: /SKILL\.md/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('new line')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('new line')).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('renders open when defaultExpanded is set', () => {
    render(
      <FileDiff
        files={[fd(), fd({ path: 'scripts/run.sh', diff: '+set -e' })]}
        defaultExpanded
      />,
    )
    for (const toggle of screen.getAllByRole('button')) {
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
    }
    expect(screen.getByText('new line')).toBeInTheDocument()
    expect(screen.getByText('set -e')).toBeInTheDocument()
  })

  it('sums +N/−N across files in the count header', () => {
    // Per-file counts also render on each row, so the totals are chosen to be
    // distinct from every per-file pair (+2/−1 and +1/−2 → +3/−3).
    render(
      <FileDiff
        files={[
          fd(), // +2 −1
          fd({ path: 'scripts/run.sh', diff: ['-old', '+set -e', '-gone'].join('\n') }), // +1 −2
        ]}
      />,
    )
    expect(screen.getByText((_c, el) => el?.textContent === '2 files changed')).toBeInTheDocument()
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(screen.getByText('−3')).toBeInTheDocument()
  })

  it('hides the count header when showCountHeader is false', () => {
    render(<FileDiff files={[fd()]} showCountHeader={false} />)
    expect(screen.queryByText(/file(s)? changed/)).not.toBeInTheDocument()
    expect(screen.getByText('new line')).toBeInTheDocument()
  })

  it('keeps content lines that collide with diff scaffolding markers', () => {
    // A deleted content line `---` serializes as `----`, an added line
    // starting `++` as `+++…` — neither is scaffolding and both must survive.
    const diff = [
      '--- a/SKILL.md@abc1234',
      '+++ b/SKILL.md@def5678',
      '@@ -1,2 +1,2 @@',
      ' intro',
      '----',
      '+++x',
    ].join('\n')
    render(<FileDiff files={[fd({ diff })]} />)
    const del = screen.getByText('---')
    const add = screen.getByText('++x')
    expect(del.className).toContain('line-through')
    expect(del.closest('div')?.className).toContain('bg-(--danger-bg)')
    expect(add.closest('div')?.className).toContain('bg-(--success-bg)')
    // Both count toward the +N/−N summary; the real headers still don't.
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('−1')).toBeInTheDocument()
  })

  it('keeps added lines starting with ++ in the added-file preview', () => {
    const diff = [
      '--- a/SKILL.md@0000000',
      '+++ b/SKILL.md@abc1234',
      '@@ -0,0 +1,2 @@',
      '+# Increment',
      '+++counter bumps twice',
    ].join('\n')
    render(<FileDiff files={[fd({ status: 'added', diff })]} />)
    expect(screen.getByRole('heading', { name: 'Increment' })).toBeInTheDocument()
    expect(screen.getByText(/\+\+counter bumps twice/)).toBeInTheDocument()
  })

  it('strips trailing CR from CRLF diffs in copyable text and previews', () => {
    const diff = ['@@ -1,1 +1,2 @@', ' intro\r', '-old crlf\r', '+new crlf\r'].join('\n')
    render(<FileDiff files={[fd({ diff })]} />)
    const add = screen.getByText('new crlf')
    const del = screen.getByText('old crlf')
    expect(add.textContent).toBe('new crlf')
    expect(del.textContent).toBe('old crlf')
    expect(screen.getByText('intro').textContent).toBe('intro')
  })

  it('drops "\\ No newline at end of file" plumbing rows and never counts them', () => {
    const diff = [
      '@@ -1,1 +1,1 @@',
      '-old line',
      '\\ No newline at end of file',
      '+new line',
      '\\ No newline at end of file',
    ].join('\n')
    render(<FileDiff files={[fd({ diff })]} />)
    expect(screen.queryByText(/No newline at end of file/)).not.toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('−1')).toBeInTheDocument()
  })

  it('renders context lines with neither add nor delete styling', () => {
    render(<FileDiff files={[fd()]} />)
    const ctx = screen.getByText('intro')
    const row = ctx.closest('div')
    expect(row?.className).toContain('text-(--ink-2)')
    expect(row?.className).not.toContain('bg-(--success-bg)')
    expect(row?.className).not.toContain('bg-(--danger-bg)')
    expect(ctx.className).not.toContain('line-through')
  })

  it('shows the binary fallback on the single-file path even when a diff string is present', () => {
    // One changed file skips the FileRow that carries the "binary" chip, so
    // the body itself has to say the file is binary.
    render(<FileDiff files={[fd({ binary: true, diff: '+not really text' })]} />)
    expect(screen.getByText('Binary file. No preview.')).toBeInTheDocument()
    expect(screen.queryByText('not really text')).not.toBeInTheDocument()
  })

  it('keeps content lines shaped like the ` a/` and ` b/` file headers', () => {
    // The review-integrity case the collision fix must close: a deleted content
    // line `-- a/x` serializes to `--- a/x` (identical to the `--- a/` file
    // header) and an added `++ b/x` to `+++ b/x`. A per-line pattern match would
    // drop them from the review surface while they still land in the signed,
    // approved content. Positional parsing keeps both as content.
    const diff = [
      '--- a/SKILL.md@abc1234',
      '+++ b/SKILL.md@def5678',
      '@@ -1,2 +1,2 @@',
      ' intro',
      '--- a/hidden-instruction',
      '+++ b/exfiltrate-secrets',
    ].join('\n')
    render(<FileDiff files={[fd({ diff })]} />)
    const del = screen.getByText('-- a/hidden-instruction')
    const add = screen.getByText('++ b/exfiltrate-secrets')
    expect(del.className).toContain('line-through')
    expect(del.closest('div')?.className).toContain('bg-(--danger-bg)')
    expect(add.closest('div')?.className).toContain('bg-(--success-bg)')
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('−1')).toBeInTheDocument()
  })

  it('keeps a `++ b/`-shaped added line in the added-file preview', () => {
    const diff = [
      '--- a/SKILL.md@0000000',
      '+++ b/SKILL.md@abc1234',
      '@@ -0,0 +1,2 @@',
      '+# Title',
      '+++ b/looks-like-a-header',
    ].join('\n')
    render(<FileDiff files={[fd({ status: 'added', diff })]} />)
    expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument()
    expect(screen.getByText(/\+\+ b\/looks-like-a-header/)).toBeInTheDocument()
  })

  it('renders a headers-only diff (identical content, no hunks) as +0/−0', () => {
    const diff = ['--- a/SKILL.md@abc1234', '+++ b/SKILL.md@abc1234'].join('\n')
    render(<FileDiff files={[fd({ diff })]} />)
    expect(screen.getByText('+0')).toBeInTheDocument()
    expect(screen.getByText('−0')).toBeInTheDocument()
  })

  it('shows the path for a single non-SKILL.md file, hides it for SKILL.md', () => {
    const { unmount } = render(
      <FileDiff files={[fd({ path: 'references/usage.md', diff: '+hi there' })]} />,
    )
    expect(screen.getByText('references/usage.md')).toBeInTheDocument()
    unmount()
    render(<FileDiff files={[fd()]} />)
    expect(screen.queryByText('SKILL.md')).not.toBeInTheDocument()
  })

  it('renders raw HTML in an added file as inert text, never live elements', () => {
    const diff = ['@@ -0,0 +1,2 @@', '+<script>alert(1)</script>', '+<img src=x onerror=alert(1)>'].join('\n')
    const { container } = render(<FileDiff files={[fd({ status: 'added', diff })]} />)
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toContain('<script')
    // Present only as escaped, inert text.
    expect(container.textContent).toContain('<script>alert(1)</script>')
  })
})
