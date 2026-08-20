import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { MarkdownEditor, type MarkdownEditorFrontmatter } from '@/components/markdown-editor'

vi.mock('@/components/markdown-content', () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="markdown-preview">{content}</div>
  ),
}))

const baseFrontmatter: MarkdownEditorFrontmatter = {
  title: 'Draft title',
  description: 'Draft description',
  publishedAt: null,
  status: 'draft',
  tags: ['skills'],
}

function renderEditor({
  storageKey,
  frontmatter = baseFrontmatter,
  value = '# Hello\n\nBody copy for testing.',
}: {
  storageKey?: string
  frontmatter?: MarkdownEditorFrontmatter
  value?: string
} = {}) {
  function Harness() {
    const [content, setContent] = useState(value)
    const [fields, setFields] = useState(frontmatter)

    return (
      <MarkdownEditor
        value={content}
        frontmatter={fields}
        storageKey={storageKey}
        onChange={(nextContent, nextFields) => {
          setContent(nextContent)
          setFields(nextFields)
        }}
      />
    )
  }

  return render(<Harness />)
}

describe('MarkdownEditor', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('renders structured frontmatter fields and mode controls', () => {
    renderEditor()

    expect(screen.getByLabelText('Title')).toHaveValue('Draft title')
    expect(screen.getByLabelText('Description')).toHaveValue('Draft description')
    expect(screen.getByLabelText('Tags')).toHaveValue('skills')
    expect(screen.getByRole('button', { name: 'edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'split' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'preview' })).toBeInTheDocument()
  })

  it('updates frontmatter and autosaves to localStorage', async () => {
    const user = userEvent.setup()
    renderEditor({ storageKey: 'markdown:test' })

    await user.clear(screen.getByLabelText('Title'))
    await user.type(screen.getByLabelText('Title'), 'Updated title')
    await user.clear(screen.getByLabelText('Tags'))
    await user.type(screen.getByLabelText('Tags'), 'skills, product')

    await waitFor(() => {
      const draft = JSON.parse(window.localStorage.getItem('markdown:test') ?? '{}')
      expect(draft.frontmatter.title).toBe('Updated title')
      expect(draft.frontmatter.tags).toEqual(['skills', 'product'])
    })
  })

  it('restores a saved draft', async () => {
    window.localStorage.setItem(
      'markdown:test',
      JSON.stringify({
        value: 'Restored body',
        frontmatter: {
          ...baseFrontmatter,
          title: 'Restored title',
          status: 'published',
        },
      }),
    )

    renderEditor({ storageKey: 'markdown:test' })

    expect(await screen.findByDisplayValue('Restored title')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Restored body')).toBeInTheDocument()
    expect(screen.getByText('Local draft restored and autosaving')).toBeInTheDocument()
  })

  it('renders markdown preview through the shared renderer', async () => {
    const user = userEvent.setup()
    renderEditor({ value: '## Preview title\n\n- one\n- two' })

    await user.click(screen.getByRole('button', { name: 'preview' }))

    expect(screen.getByTestId('markdown-preview')).toHaveTextContent('## Preview title')
  })
})
