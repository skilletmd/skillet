import { describe, it, expect } from 'vitest'
import { getDoc } from './docs'

describe('getDoc path containment', () => {
  it('rejects traversal segments', () => {
    expect(getDoc(['..', 'package'])).toBeNull()
    expect(getDoc(['reference', '..', '..', 'package'])).toBeNull()
  })

  it('rejects segments with backslashes or NUL', () => {
    expect(getDoc(['foo\\bar'])).toBeNull()
    expect(getDoc(['foo\0bar'])).toBeNull()
  })
})
