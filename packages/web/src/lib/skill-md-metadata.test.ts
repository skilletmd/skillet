import { describe, expect, it } from 'vitest'
import { skillFrontmatterField, skillMarkdownMetadata } from './skill-md-metadata'

describe('skillFrontmatterField', () => {
  it('reads plain and quoted scalars', () => {
    expect(skillFrontmatterField('description: Do the thing.', 'description')).toBe('Do the thing.')
    expect(skillFrontmatterField('description: "Do the thing."', 'description')).toBe('Do the thing.')
  })

  it('folds `>-` block scalars to a single spaced line (MongoDB/Stripe style)', () => {
    const fm = [
      'name: mongodb-query-optimizer',
      'description: >-',
      '  Help with MongoDB query optimization and indexing.',
      '  Use only when the user asks for performance help.',
      'license: Apache-2.0',
    ].join('\n')
    expect(skillFrontmatterField(fm, 'description')).toBe(
      'Help with MongoDB query optimization and indexing. Use only when the user asks for performance help.',
    )
    expect(skillFrontmatterField(fm, 'license')).toBe('Apache-2.0')
  })

  it('keeps newlines for literal `|` block scalars', () => {
    const fm = ['description: |', '  line one', '  line two'].join('\n')
    expect(skillFrontmatterField(fm, 'description')).toBe('line one\nline two')
  })

  it('never returns the block-scalar indicator itself', () => {
    for (const ind of ['>', '>-', '>+', '|', '|-']) {
      const got = skillFrontmatterField(`description: ${ind}\n  real text`, 'description')
      expect(got).toBe('real text')
    }
  })
})

describe('skillMarkdownMetadata', () => {
  it('parses a block-scalar description out of a full SKILL.md', () => {
    const md = ['---', 'name: demo', 'description: >-', '  Folded description.', '---', '', '# Demo'].join('\n')
    const meta = skillMarkdownMetadata(md)
    expect(meta.name).toBe('demo')
    expect(meta.description).toBe('Folded description.')
  })
})
