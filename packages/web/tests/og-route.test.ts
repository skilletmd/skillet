import { describe, it, expect } from 'vitest'
import { parseOgArgs } from '@/app/api/og/route'

// Public unauthenticated OG renderer must cap untrusted inputs.
describe('parseOgArgs input caps', () => {
  it('caps the cats array length', () => {
    const params = new URLSearchParams({ cats: Array.from({ length: 1000 }, (_, i) => `c${i}`).join(',') })
    expect(parseOgArgs(params).cats!.length).toBeLessThanOrEqual(20)
  })

  it('caps the faces array length', () => {
    const params = new URLSearchParams({ faces: Array.from({ length: 1000 }, (_, i) => `f${i}`).join(',') })
    expect(parseOgArgs(params).faces!.length).toBeLessThanOrEqual(10)
  })

  it('truncates oversized string fields', () => {
    const params = new URLSearchParams({ title: 'A'.repeat(5000) })
    expect(parseOgArgs(params).title.length).toBeLessThanOrEqual(200)
  })

  it('preserves normal inputs', () => {
    const params = new URLSearchParams({ type: 'profile', title: 'Taylor', cats: 'a,b,c', team: '1' })
    const args = parseOgArgs(params)
    expect(args.title).toBe('Taylor')
    expect(args.cats).toEqual(['a', 'b', 'c'])
    expect(args.team).toBe(true)
  })
})
