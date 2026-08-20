import { describe, expect, it } from 'vitest'
import { skillMarkdownMetadata, skillFrontmatterField } from '@/lib/skill-md-metadata'

describe('skillFrontmatterField', () => {
  it('returns null for an empty field without bleeding the next line', () => {
    const fm = 'name: \ndescription: A short description.'
    expect(skillFrontmatterField(fm, 'name')).toBeNull()
    expect(skillFrontmatterField(fm, 'description')).toBe('A short description.')
  })

  it('reads both fields when populated', () => {
    const fm = 'name: my-skill\ndescription: Does a thing.'
    expect(skillFrontmatterField(fm, 'name')).toBe('my-skill')
    expect(skillFrontmatterField(fm, 'description')).toBe('Does a thing.')
  })

  it('strips surrounding quotes and keeps inner colons', () => {
    expect(skillFrontmatterField('description: "a: b"', 'description')).toBe('a: b')
  })
})

describe('skillMarkdownMetadata after clearing the name', () => {
  it('does not put the description into the name', () => {
    const md = '---\nname: \ndescription: A short description.\n---\n\n## Body\n'
    const meta = skillMarkdownMetadata(md)
    expect(meta.name).toBeNull()
    expect(meta.description).toBe('A short description.')
  })
})
