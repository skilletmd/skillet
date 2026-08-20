// Browser-native canonical content hash — byte-identical to
// @skillet/protocol::canonicalContentHash (§4.2 step 1, §9.6, invariant #6).
//
// The protocol implementation hashes over DECODED bytes (packages/protocol/src/bundle.ts):
//
//   sha256( for each path in lexicographic BYTE order:
//             u64be(len(utf8(path))) || utf8(path) ||
//             u64be(len(content))    || raw_content_bytes )
//
// prefixed with "sha256:". It is the registry's source of truth, but it is built
// on node:crypto (`createHash`) + `Buffer`, which cannot run natively in the
// browser. A divergent hash = an unverifiable device signature, so this is a
// vetted Web-platform port (TextEncoder + crypto.subtle.digest) pinned to the
// protocol output by committed conformance vectors
// (tests/webcrypto-content-hash.test.ts). The CI test asserts this port and
// @skillet/protocol produce the same hash for every fixture bundle (§9.6).
//
// This is the value the in-browser device key signs (see device-key.ts) and that
// the registry recomputes server-side before verifying the signature.

export const CONTENT_HASH_PREFIX = 'sha256:'

/** Decoded bundle: path → raw bytes. The canonical hash operates on this. */
export type DecodedBundle = Map<string, Uint8Array>

/**
 * Lexicographic BYTE order over UTF-8 path bytes — NOT JS string comparison,
 * which orders by UTF-16 code unit and diverges for non-ASCII paths. Mirrors
 * `Buffer.compare` in the protocol implementation.
 */
function comparePathBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i]
  }
  return a.length - b.length
}

function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

/**
 * Compute the canonical content hash of a decoded bundle, byte-identical to
 * `@skillet/protocol::canonicalContentHash`. Returns `"sha256:" + 64 lowercase
 * hex`. Async because `crypto.subtle.digest` is async (the only SHA-256 the Web
 * platform exposes without bundling node:crypto).
 */
export async function canonicalContentHash(bundle: DecodedBundle): Promise<string> {
  const enc = new TextEncoder()
  const entries = [...bundle.entries()].map(([path, data]) => ({
    pathBytes: enc.encode(path),
    data,
  }))
  entries.sort((x, y) => comparePathBytes(x.pathBytes, y.pathBytes))

  // One contiguous buffer of
  //   u64be(len(path)) || path || u64be(len(content)) || content
  // per path, in sorted order. Fixed-width 8-byte big-endian length prefixes
  // (matching Node's Buffer.writeBigUInt64BE) make the framing unambiguous —
  // no content byte can be mistaken for a delimiter. Streaming (per-chunk) and
  // one-shot SHA-256 yield the same digest, so a single subtle.digest matches
  // the protocol's chunked updates.
  let total = 0
  for (const e of entries) total += 8 + e.pathBytes.length + 8 + e.data.length
  const buf = new Uint8Array(total)
  const view = new DataView(buf.buffer)
  let off = 0
  for (const e of entries) {
    view.setBigUint64(off, BigInt(e.pathBytes.length), false)
    off += 8
    buf.set(e.pathBytes, off)
    off += e.pathBytes.length
    view.setBigUint64(off, BigInt(e.data.length), false)
    off += 8
    buf.set(e.data, off)
    off += e.data.length
  }

  const digest = await crypto.subtle.digest('SHA-256', buf)
  return CONTENT_HASH_PREFIX + bytesToHex(new Uint8Array(digest))
}
