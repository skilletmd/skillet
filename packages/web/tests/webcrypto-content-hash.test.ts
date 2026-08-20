// Conformance: the browser-native content hash MUST be byte-identical to
// @skillet/protocol::canonicalContentHash (§9.6, invariant #6). A
// divergent hash makes the in-browser device signature unverifiable by the
// registry. This test triple-pins the value: committed vector == @skillet/protocol
// == the browser port, for every fixture bundle (text, binary, unicode, and a
// UTF-8 byte-order edge that a naive string sort would get wrong).

import { describe, it, expect } from 'vitest'
import { canonicalContentHash as protocolContentHash, decodeBundle } from '@skillet/protocol'
import { canonicalContentHash as browserContentHash } from '@/lib/webcrypto-content-hash'
import vectors from './fixtures/content-hash-vectors.json'

type WireEntry = { enc: 'utf8' | 'base64'; data: string }
type Vector = { name: string; files: Record<string, WireEntry>; expected: string }

/** Decode wire bundle → path→bytes using only Web-platform APIs (mirrors the browser). */
function decodeToBytes(files: Record<string, WireEntry>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>()
  for (const [path, entry] of Object.entries(files)) {
    if (entry.enc === 'utf8') {
      out.set(path, new TextEncoder().encode(entry.data))
    } else {
      const bin = atob(entry.data)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)
      out.set(path, bytes)
    }
  }
  return out
}

describe('webcrypto canonicalContentHash conformance', () => {
  it.each(vectors as unknown as Vector[])(
    'matches protocol + committed vector: $name',
    async (vector) => {
      const browserBytes = decodeToBytes(vector.files)
      const browserHash = await browserContentHash(browserBytes)

      // The registry's source of truth (node:crypto + Buffer).
      const protocolHash = protocolContentHash(decodeBundle(vector.files))

      expect(browserHash).toBe(vector.expected)
      expect(protocolHash).toBe(vector.expected)
      expect(browserHash).toBe(protocolHash)
    },
  )

  it('orders paths by UTF-8 bytes, not UTF-16 code units', async () => {
    // U+FF21 (EF BC A1) sorts BEFORE U+1F600 (F0 9F 98 80) by UTF-8 bytes, but
    // a JS string sort would put the emoji first. Inserting the keys in the
    // "wrong" order must still produce the committed hash.
    const forward = new Map<string, Uint8Array>([
      ['Ａ.md', new TextEncoder().encode('fullwidth-A\n')],
      ['\u{1F600}.md', new TextEncoder().encode('grinning\n')],
      ['SKILL.md', new TextEncoder().encode('x\n')],
    ])
    const reversed = new Map([...forward.entries()].reverse())
    const a = await browserContentHash(forward)
    const b = await browserContentHash(reversed)
    expect(a).toBe(b) // insertion order must not matter
    const vector = (vectors as unknown as Vector[]).find(
      (v) => v.name === 'utf8-byte-order vs utf16 divergence',
    )
    expect(a).toBe(vector!.expected)
  })
})
