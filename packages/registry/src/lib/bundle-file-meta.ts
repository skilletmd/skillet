import { isTextFile, decodeText } from '../scanner/text-files.js'
import { isTextExtension, SCRIPT_EXTENSIONS, extOf } from '../scanner/file-classes.js'

const EXECUTABLE_EXTENSIONS = new Set([
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'app',
  'msi',
  'deb',
  'rpm',
  'apk',
  'dmg',
  'pkg',
  'wasm',
])

/** Path + stored byte length only — no blob fetch (file index endpoint). */
export function fileMetaFromPathAndSize(
  path: string,
  size: number,
): { path: string; kind: 'text' | 'binary'; size: number; executable: boolean } {
  const ext = extOf(path)
  const kind: 'text' | 'binary' = isTextExtension(path) ? 'text' : 'binary'
  const executable =
    SCRIPT_EXTENSIONS.has(ext) || (ext.length > 1 && EXECUTABLE_EXTENSIONS.has(ext.slice(1)))
  return { path, kind, size, executable }
}

/** Full bytes — per-file body endpoint (accurate kind/executable/text). */
export function fileMetaFromBytes(
  path: string,
  bytes: Uint8Array,
): {
  path: string
  kind: 'text' | 'binary'
  size: number
  executable: boolean
  text?: string
} {
  const textLike = isTextFile(path, bytes)
  const kind: 'text' | 'binary' = textLike ? 'text' : 'binary'
  const executable = isLikelyExecutable(path, bytes)
  return {
    path,
    kind,
    size: bytes.length,
    executable,
    ...(textLike ? { text: decodeText(bytes) } : {}),
  }
}

function isLikelyExecutable(path: string, bytes: Uint8Array): boolean {
  const ext = extOf(path).slice(1)
  if (EXECUTABLE_EXTENSIONS.has(ext)) return true
  if (SCRIPT_EXTENSIONS.has(extOf(path))) return true
  if (bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) return true
  if (bytes.length >= 4) {
    const elf = bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46
    const pe = bytes[0] === 0x4d && bytes[1] === 0x5a
    const magic = ((bytes[0] << 24) >>> 0) + (bytes[1] << 16) + (bytes[2] << 8) + bytes[3]
    const machO = [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe, 0xbebafeca].includes(
      magic,
    )
    if (elf || pe || machO) return true
  }
  return false
}

/** Reject traversal and absolute paths before DB lookup. */
export function normalizeBundleFilePath(raw: string): string | null {
  if (!raw || raw.includes('\\')) return null
  if (raw.startsWith('/') || raw.includes('..')) return null
  const segments = raw.split('/')
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return null
  return raw
}
