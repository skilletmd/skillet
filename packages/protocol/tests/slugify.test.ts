import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { slugify } from '../src/slugify.js'

describe('slugify', () => {
  it("elides straight apostrophes instead of dashing them", () => {
    assert.equal(slugify("writer's room"), 'writers-room')
  })

  it('elides typographic apostrophe variants', () => {
    assert.equal(slugify('writer’s room'), 'writers-room')
    assert.equal(slugify('writer‘s room'), 'writers-room')
  })

  it('handles multiple apostrophes and trailing punctuation', () => {
    assert.equal(slugify("Maya's Writer's Room!"), 'mayas-writers-room')
  })

  it('trims leading and trailing punctuation to dashes-free edges', () => {
    assert.equal(slugify('  --Hello, World--  '), 'hello-world')
  })

  it('returns empty string for all-punctuation input without a fallback', () => {
    assert.equal(slugify('!!!'), '')
    assert.equal(slugify(''), '')
  })

  it('uses the fallback when the result is empty', () => {
    assert.equal(slugify('!!!', { fallback: 'kit' }), 'kit')
    assert.equal(slugify('', { fallback: 'kit' }), 'kit')
  })

  it('truncates to maxLength without leaving a trailing dash', () => {
    // 'aaaa bbbb' → 'aaaa-bbbb'; cap at 5 would land on the dash, so it trims back to 'aaaa'
    assert.equal(slugify('aaaa bbbb', { maxLength: 5 }), 'aaaa')
    assert.equal(slugify('abcdefghij', { maxLength: 4 }), 'abcd')
  })

  it('caps at 64 chars like the kit slugifier', () => {
    const long = 'a'.repeat(100)
    assert.equal(slugify(long, { fallback: 'kit', maxLength: 64 }).length, 64)
  })

  it('is idempotent on already-clean slugs', () => {
    assert.equal(slugify('writers-room'), 'writers-room')
  })
})
