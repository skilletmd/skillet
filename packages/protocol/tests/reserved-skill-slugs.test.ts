import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { RESERVED_SKILL_SLUGS, isReservedSkillSlug, isValidSkillSlug } from '../src/reserved-skill-slugs.js'

describe('reserved skill slugs', () => {
  it('reserves the static owner-namespace route segments', () => {
    for (const slug of ['kit', 'followers', 'following', 'installs']) {
      assert.equal(isReservedSkillSlug(slug), true, slug)
    }
  })

  it('is case-insensitive and trims', () => {
    assert.equal(isReservedSkillSlug('KIT'), true)
    assert.equal(isReservedSkillSlug('  Followers  '), true)
  })

  it('allows ordinary skill slugs', () => {
    for (const slug of ['festival-ops', 'writers-room', 'kits', 'kit-builder', 'follow']) {
      assert.equal(isReservedSkillSlug(slug), false, slug)
    }
  })

  // Drift guard: if a new static [author]/<segment> route is added, this set and
  // the permalink-routing test must be updated in lockstep. Hard-coded mirror of
  // the static segments so an accidental removal here fails CI.
  it('contains exactly the known static owner-namespace segments', () => {
    assert.deepEqual([...RESERVED_SKILL_SLUGS].sort(), ['followers', 'following', 'installs', 'kit'])
  })
})

describe('skill slug grammar', () => {
  it('accepts lowercase hyphenated slugs', () => {
    assert.equal(isValidSkillSlug('deploy-ritual'), true)
    assert.equal(isValidSkillSlug('a'), true)
  })

  it('rejects uppercase, spaces, and punctuation', () => {
    assert.equal(isValidSkillSlug('Bad-Slug'), false)
    assert.equal(isValidSkillSlug('bad slug'), false)
    assert.equal(isValidSkillSlug('bad.slug'), false)
  })
})
