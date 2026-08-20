import { describe, it, expect } from 'vitest'
import { parseCliJson } from './cli-json'

describe('parseCliJson', () => {
  it('parses JSON after leading log lines', () => {
    const raw = 'Sidecar version OK\n{"ok":true,"kits":[]}\n'
    const res = parseCliJson<{ ok: boolean; kits: unknown[] }>(raw, 'sync')
    expect(res.ok).toBe(true)
    expect(res.kits).toEqual([])
  })

  it('parses array payloads', () => {
    const raw = 'warn: retry\n[{"slug":"a"}]'
    const res = parseCliJson<Array<{ slug: string }>>(raw, 'list')
    expect(res).toEqual([{ slug: 'a' }])
  })

  it('throws when stdout has no JSON', () => {
    expect(() => parseCliJson('', 'sync')).toThrow(/sync returned no JSON/)
  })

  it('includes label in empty message', () => {
    expect(() => parseCliJson('   \n  ', 'auth status')).toThrow(/auth status returned no JSON/)
  })
})
