import { describe, it, expect } from 'vitest'
import { createVersionBodyCache } from './version-body-cache'
import type { SkillBundleFileEntry } from './skill-bundle-content'

function files(bytes: number, tag = 'x'): SkillBundleFileEntry[] {
  return [{ path: `${tag}.txt`, kind: 'text', size: bytes, executable: false, text: tag }]
}

describe('version-body-cache LRU', () => {
  it('stores and returns a file map by hash', () => {
    const cache = createVersionBodyCache()
    const f = files(10, 'a')
    cache.set('h1', f)
    expect(cache.get('h1')).toBe(f)
    expect(cache.get('missing')).toBeUndefined()
  })

  it('evicts the least-recently-used entry when over the entry cap', () => {
    const cache = createVersionBodyCache({ maxEntries: 2, maxBytes: 1_000_000 })
    cache.set('h1', files(1, 'a'))
    cache.set('h2', files(1, 'b'))
    // Touch h1 so h2 becomes the LRU.
    cache.get('h1')
    cache.set('h3', files(1, 'c'))
    expect(cache.get('h2')).toBeUndefined() // evicted
    expect(cache.get('h1')).toBeDefined()
    expect(cache.get('h3')).toBeDefined()
    expect(cache.size()).toBe(2)
  })

  it('evicts by total byte budget, not just entry count', () => {
    const cache = createVersionBodyCache({ maxEntries: 100, maxBytes: 100 })
    cache.set('h1', files(60, 'a'))
    cache.set('h2', files(60, 'b')) // 120 > 100 → evict h1
    expect(cache.get('h1')).toBeUndefined()
    expect(cache.get('h2')).toBeDefined()
    expect(cache.size()).toBe(1)
  })

  it('does not cache a single body larger than the whole byte budget', () => {
    const cache = createVersionBodyCache({ maxEntries: 100, maxBytes: 50 })
    cache.set('huge', files(200, 'a'))
    expect(cache.get('huge')).toBeUndefined()
    expect(cache.size()).toBe(0)
  })

  it('delete removes an entry and frees its bytes', () => {
    const cache = createVersionBodyCache({ maxEntries: 2, maxBytes: 100 })
    cache.set('h1', files(90, 'a'))
    cache.delete('h1')
    expect(cache.get('h1')).toBeUndefined()
    // Freed bytes → a new 90-byte entry fits without evicting anything else.
    cache.set('h2', files(90, 'b'))
    expect(cache.get('h2')).toBeDefined()
    expect(cache.size()).toBe(1)
  })

  it('overwriting a hash updates bytes accounting (no double count)', () => {
    const cache = createVersionBodyCache({ maxEntries: 100, maxBytes: 100 })
    cache.set('h1', files(40, 'a'))
    cache.set('h1', files(40, 'a')) // same key again
    cache.set('h2', files(40, 'b')) // 80 total → fits (would exceed if double-counted)
    expect(cache.get('h1')).toBeDefined()
    expect(cache.get('h2')).toBeDefined()
    expect(cache.size()).toBe(2)
  })
})
