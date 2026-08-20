import { describe, expect, it } from 'vitest'
import { extractPairCode, pairCodeInputError } from './pair-code'

describe('pair-code', () => {
  it('extracts a bare code', () => {
    expect(extractPairCode('99MZGKAU')).toBe('99MZGKAU')
    expect(extractPairCode('99mz-gkau')).toBe('99MZGKAU')
  })

  it('extracts from a full CLI command paste', () => {
    expect(extractPairCode('npx skilletmd connect 99MZGKAU')).toBe('99MZGKAU')
  })

  it('surfaces command-shaped paste errors', () => {
    expect(pairCodeInputError('npx skilletmd connect 99MZGKAU')).toMatch(/not the full command/)
  })

  it('surfaces invalid charset errors', () => {
    expect(pairCodeInputError('ABCD0123')).toMatch(/letters and numbers/)
  })

  it('defaults to length prompt for short input', () => {
    expect(pairCodeInputError('abc')).toBe('Enter the 8-character code.')
  })
})
