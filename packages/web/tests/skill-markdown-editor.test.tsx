import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SkillMarkdownEditor } from '@/components/skill-markdown-editor'

const starter = `---
name: new-skill
description: A short description.
---

When to use this

Body copy.
`

describe('SkillMarkdownEditor', () => {
  it('syncs visual body edits back to markdown while preserving frontmatter', () => {
    const onChange = vi.fn()
    render(<SkillMarkdownEditor value={starter} onChange={onChange} mode="rich" showMetadata />)

    const visual = screen.getByLabelText('Visual editor')
    visual.innerHTML = '<h2>Visual heading</h2><p>Edited on the surface.</p>'
    fireEvent.input(visual)

    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('name: new-skill'))
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('## Visual heading'))
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('Edited on the surface.'))
  })

  it('edits the inline name and description as frontmatter', () => {
    const onChange = vi.fn()
    render(<SkillMarkdownEditor value={starter} onChange={onChange} mode="rich" showMetadata />)

    fireEvent.change(screen.getByLabelText('Skill name'), { target: { value: 'visual-skill' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('name: visual-skill'))

    fireEvent.change(screen.getByLabelText('Skill description'), {
      target: { value: 'New summary.' },
    })
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('description: New summary.'))
  })

  it('keeps trailing spaces while typing in the description (frontmatter trims on round-trip)', () => {
    function Harness() {
      const [value, setValue] = useState(starter)
      return <SkillMarkdownEditor value={value} onChange={setValue} mode="rich" showMetadata />
    }
    render(<Harness />)

    const description = screen.getByLabelText('Skill description') as HTMLInputElement
    // Simulate keystrokes through a controlled parent: the trailing space must
    // survive the markdown round-trip so the next word can be typed.
    fireEvent.change(description, { target: { value: 'testing ' } })
    expect(description.value).toBe('testing ')
    fireEvent.change(description, { target: { value: 'testing how spaces work' } })
    expect(description.value).toBe('testing how spaces work')

    // On blur the draft resolves back to the canonical frontmatter value.
    fireEvent.change(description, { target: { value: 'trimmed at rest ' } })
    fireEvent.blur(description)
    expect(description.value).toBe('trimmed at rest')
  })

  it('switches to a raw markdown surface in source mode', () => {
    const onChange = vi.fn()
    render(<SkillMarkdownEditor value={starter} onChange={onChange} mode="source" showMetadata />)

    expect(screen.queryByLabelText('Visual editor')).toBeNull()
    const textarea = screen.getByLabelText('Markdown editor')
    expect(textarea).toBeInTheDocument()
    expect((textarea as HTMLTextAreaElement).value).toContain('name: new-skill')
  })

  it('hides the name/description fields on non-entrypoint markdown files', () => {
    const doc = '# Callable Methods\n\nBody copy.\n'
    const onChange = vi.fn()
    render(<SkillMarkdownEditor value={doc} onChange={onChange} mode="rich" showMetadata={false} />)

    // No frontmatter fields — typing in them would inject a YAML block into a
    // file that never had one.
    expect(screen.queryByLabelText('Skill name')).toBeNull()
    expect(screen.queryByLabelText('Skill description')).toBeNull()

    // Body edits still round-trip without growing frontmatter.
    const visual = screen.getByLabelText('Visual editor')
    visual.innerHTML = '<p>Edited body.</p>'
    fireEvent.input(visual)
    expect(onChange).toHaveBeenLastCalledWith(expect.not.stringContaining('---'))
    expect(onChange).toHaveBeenLastCalledWith(expect.stringContaining('Edited body.'))
  })

  it('keeps a blank create scaffold empty (no stray paragraph or placeholder body)', () => {
    const blank = `---
name:
description:
---
`
    const onChange = vi.fn()
    render(<SkillMarkdownEditor value={blank} onChange={onChange} mode="rich" showMetadata />)

    const visual = screen.getByLabelText('Visual editor')
    // Empty body must stay DOM-empty so the CSS placeholder can show — a
    // trailing <p><br></p> was rendering as a blank line in the instructions.
    expect(visual.innerHTML).toBe('')

    // Clearing the visual surface must not bake "Write your skill instructions
    // here." (or any other placeholder) into the markdown body.
    visual.innerHTML = '<p><br></p>'
    fireEvent.input(visual)
    expect(onChange).toHaveBeenLastCalledWith(blank)
    expect(onChange).toHaveBeenLastCalledWith(expect.not.stringContaining('Write your skill'))
  })
})
