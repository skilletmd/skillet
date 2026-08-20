import { describe, it, expect } from 'vitest'
import { frontmatterRows } from './frontmatter-display'

describe('frontmatterRows', () => {
  it('reads flat scalars and strips quotes', () => {
    expect(frontmatterRows("name: my-skill\nlicense: MIT\nversion: '1.0.0'")).toEqual([
      { key: 'name', value: 'my-skill' },
      { key: 'license', value: 'MIT' },
      { key: 'version', value: '1.0.0' },
    ])
  })

  it('joins folded multi-line descriptions with spaces', () => {
    const rows = frontmatterRows(
      'description:\n  React composition patterns that scale.\n  Use when refactoring components.\nlicense: MIT',
    )
    expect(rows).toEqual([
      {
        key: 'description',
        value: 'React composition patterns that scale. Use when refactoring components.',
      },
      { key: 'license', value: 'MIT' },
    ])
  })

  it('supports > and | block scalars', () => {
    expect(frontmatterRows('description: >-\n  a\n  b')).toEqual([
      { key: 'description', value: 'a b' },
    ])
    expect(frontmatterRows('notes: |\n  a\n  b')).toEqual([{ key: 'notes', value: 'a\nb' }])
  })

  it('flattens one-level nested maps to dotted keys', () => {
    expect(frontmatterRows("metadata:\n  author: vercel\n  version: '1.0.0'")).toEqual([
      { key: 'metadata.author', value: 'vercel' },
      { key: 'metadata.version', value: '1.0.0' },
    ])
  })

  it('joins lists', () => {
    expect(frontmatterRows('allowed-tools:\n  - Read\n  - Grep')).toEqual([
      { key: 'allowed-tools', value: 'Read, Grep' },
    ])
  })

  it('passes unparseable lines through raw instead of dropping them', () => {
    const rows = frontmatterRows('name: x\n%weird directive')
    expect(rows).toContainEqual({ key: '…', value: '%weird directive' })
    expect(rows).toContainEqual({ key: 'name', value: 'x' })
  })
})
