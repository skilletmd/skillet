import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { Editor } from '@/app/admin/blog/[slug]/editor'
import type { Post } from '@/lib/blog'

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string
    children: React.ReactNode
    [k: string]: unknown
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

vi.mock('@/app/admin/blog/actions', () => ({
  savePost: vi.fn().mockResolvedValue(undefined),
}))

const basePost = (overrides: Partial<Post> = {}): Post => ({
  title: 'Hello world',
  slug: 'hello-world',
  description: 'A post.',
  author: 'Taylor',
  publishedAt: '2026-06-20',
  tags: ['skills'],
  featured: false,
  readTime: 1,
  status: 'draft',
  content: '# Heading\n\nSome **bold** text.\n',
  ...overrides,
})

describe('Admin Editor', () => {
  it('renders title, description, and markdown body in write mode by default', () => {
    render(<Editor post={basePost()} saved={false} />)
    expect(screen.getByDisplayValue('Hello world')).toBeInTheDocument()
    expect(screen.getByDisplayValue('A post.')).toBeInTheDocument()
    const textarea = screen.getByRole('textbox', { name: '' }) as HTMLTextAreaElement
    // The body textarea is borderless; assert by tag instead
    const allTextareas = document.querySelectorAll('textarea')
    expect(allTextareas[0].value).toContain('# Heading')
    expect(textarea).toBeTruthy()
  })

  it('exposes Markdown and Preview tabs', () => {
    render(<Editor post={basePost()} saved={false} />)
    expect(screen.getByRole('tab', { name: 'Markdown' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'false')
  })

  it('switches to preview and renders markdown as HTML', async () => {
    const user = userEvent.setup()
    render(<Editor post={basePost({ content: '# Title\n\nBody.' })} saved={false} />)

    await user.click(screen.getByRole('tab', { name: 'Preview' }))

    const preview = screen.getByRole('textbox', { name: 'Rendered editor' })
    expect(preview.innerHTML).toContain('<h1>')
    expect(preview.innerHTML).toContain('Title')
    expect(preview.innerHTML).toContain('Body.')
  })

  it('preserves edits in rendered mode when toggling back to markdown', async () => {
    const user = userEvent.setup()
    render(<Editor post={basePost({ content: 'Original line.' })} saved={false} />)

    await user.click(screen.getByRole('tab', { name: 'Preview' }))
    const preview = screen.getByRole('textbox', { name: 'Rendered editor' })
    // simulate a content edit by mutating innerHTML
    preview.innerHTML = '<p>Original line.</p><p>Added paragraph.</p>'
    fireEvent.input(preview)

    await user.click(screen.getByRole('tab', { name: 'Markdown' }))

    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    expect(textarea.value).toContain('Original line.')
    expect(textarea.value).toContain('Added paragraph.')
  })

  it('shows a Saved status indicator when the saved prop is true', () => {
    render(<Editor post={basePost()} saved />)
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
  })
})
