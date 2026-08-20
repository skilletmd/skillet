import { describe, it, expect } from 'vitest'
import { parseSkillRef, resolveSkillForRef } from './viewer'
import type { KitStatus, Skill } from './tray-logic'

// FIX 1 (P2, Codex): the viewer used to resolve `?skill=` refs by bare slug
// only, so opening `@alice/foo` could render `@bob/foo`'s body when both were
// installed under the same slug — the wrong skill, while diff/propose still
// acted on `@alice/foo`. resolveSkillForRef matches owner AND slug for an
// owned ref, falling back to slug-only for a bare/unowned ref.

const skill = (owner: string | null, slug: string): Skill => ({
  slug,
  name: slug,
  description: '',
  owner,
  source: 'kit',
  pinned: false,
  body: `# ${owner ?? 'unowned'}/${slug}\n`,
})

const kitOf = (...skills: Skill[]): KitStatus => ({
  skills,
  groups: [],
})

describe('parseSkillRef', () => {
  it('splits an owned ref into owner + slug', () => {
    expect(parseSkillRef('@alice/foo')).toEqual({ owner: 'alice', slug: 'foo' })
  })

  it('treats a bare/unowned ref as owner-less', () => {
    expect(parseSkillRef('foo')).toEqual({ owner: null, slug: 'foo' })
  })

  it('strips a leading @ from a bare ref with no slash', () => {
    expect(parseSkillRef('@foo')).toEqual({ owner: null, slug: 'foo' })
  })
})

describe('resolveSkillForRef (R14 fix — owner disambiguates same-slug skills)', () => {
  it('opening @alice/foo resolves alice\'s body, not bob\'s, when both ship "foo"', () => {
    const kit = kitOf(skill('bob', 'foo'), skill('alice', 'foo'))
    const hit = resolveSkillForRef(kit, '@alice/foo')
    expect(hit?.owner).toBe('alice')
    expect(hit?.body).toContain('alice/foo')
  })

  it('opening @bob/foo resolves bob\'s body, not alice\'s', () => {
    const kit = kitOf(skill('bob', 'foo'), skill('alice', 'foo'))
    const hit = resolveSkillForRef(kit, '@bob/foo')
    expect(hit?.owner).toBe('bob')
    expect(hit?.body).toContain('bob/foo')
  })

  it('a bare/unowned ref still resolves (no owner to disambiguate against)', () => {
    const kit = kitOf(skill(null, 'refund-policy'))
    const hit = resolveSkillForRef(kit, 'refund-policy')
    expect(hit?.slug).toBe('refund-policy')
  })

  it('an owned ref with no matching owner+slug pair returns null (no wrong-skill fallback)', () => {
    const kit = kitOf(skill('bob', 'foo'))
    expect(resolveSkillForRef(kit, '@alice/foo')).toBeNull()
  })
})
