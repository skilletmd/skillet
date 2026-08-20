// Browser-safe skill-bundle helpers for the propose-update flow.
//
// A skill bundle is a map of POSIX-relative paths to per-file encoded content
// (`enc: utf8 | base64`), exactly the wire shape the registry serves from
// `GET /v1/skills/:author/:slug/versions/:hash` and accepts at
// `POST .../proposals` (see packages/protocol/src/bundle.ts — the source of
// truth). These helpers never import @skillet/protocol: that package depends on
// `node:crypto` / `Buffer` and cannot run in the browser, where the editor and
// diff preview live. We re-derive only the small, transport-level pieces the UI
// needs (decode, byte-equality, graded per-file diff) on the standard Web
// platform (TextEncoder / atob), so the same code runs in SSR and the client.
//
// The canonical content hash and Ed25519 signature are deliberately NOT here:
// the registry recomputes the hash server-side and verifies the signature
// against the proposer's registered key, and browser signing is a separate,
// security-gated subsystem (see proposals.ts → createSkillProposal).

import type { ProposalFileDiff } from './types'
import { splitSkillMdFrontmatter } from './skill-md-body'
import { bundlePathError as protocolBundlePathError } from '@skillet/protocol'

/** Transport encoding for one bundle file. */
export type BundleEncoding = 'utf8' | 'base64'

/** One file as it travels on the wire: `{ enc, data }`. */
export interface BundleFileEntry {
  enc: BundleEncoding
  data: string
}

/** Wire-format bundle: path → `{ enc, data }`. Mirrors protocol `BundleFiles`. */
export type BundleFiles = Record<string, BundleFileEntry>

/** Required entrypoint — every valid bundle has SKILL.md at its root (§2.1). */
export const SKILL_ENTRYPOINT = 'SKILL.md'

/** Ephemeral atomic-write backup suffix; never part of publishable skill content. */
export const SKILLET_BACKUP_SUFFIX = '.skillet-backup'

export function isSkilletBackupPath(path: string): boolean {
  return path.endsWith(SKILLET_BACKUP_SUFFIX)
}

/** Decoded view of a bundle file: raw bytes plus a text view when it is text. */
export interface DecodedFile {
  bytes: Uint8Array
  /** UTF-8 text, or `null` when the file is binary (no clean text view). */
  text: string | null
  binary: boolean
}

function base64ToBytes(data: string): Uint8Array {
  // atob is available in browsers and in Node's global scope (16+).
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** A file is treated as binary when it carries a NUL byte (matches our text-file gate). */
function looksBinary(bytes: Uint8Array): boolean {
  return bytes.includes(0)
}

/**
 * Decode a wire entry into bytes + an optional text view. `utf8` entries are
 * always text; `base64` entries are text only when they round-trip cleanly and
 * carry no NUL byte (matching how `encodeBundle` picks utf8 vs base64).
 */
export function decodeFile(entry: BundleFileEntry): DecodedFile {
  if (entry.enc === 'utf8') {
    return { bytes: new TextEncoder().encode(entry.data), text: entry.data, binary: false }
  }
  const bytes = base64ToBytes(entry.data)
  if (looksBinary(bytes)) return { bytes, text: null, binary: true }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { bytes, text, binary: false }
  } catch {
    return { bytes, text: null, binary: true }
  }
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false
  return true
}

// ---------------------------------------------------------------------------
// Graded diff (AC #2: "show graded diff vs base_hash before submit").
//
// The registry produces the authoritative graded diff at proposal-detail time
// (review surface). This client-side version grades the *pending* edit
// before submit so the proposer sees exactly what they are about to send. It
// renders a minimal unified diff for text files via an LCS line diff; binary
// changes are graded (added/removed/modified) but carry `diff: null`, same as
// the server contract (ProposalFileDiff).
// ---------------------------------------------------------------------------

/** Split into lines, dropping the single trailing empty element a final newline
 *  produces — so a file ending in "\n" is N lines, not N+1. Without this, adding
 *  content at EOF renders a phantom trailing "+" blank line (the shifted final
 *  newline), even though the text ends exactly where the caret does. Mirrors the
 *  registry's splitLines so client preview and server diff agree. */
function diffLines(text: string): string[] {
  if (text.length === 0) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Longest-common-subsequence over two line arrays → unified-diff body. */
function unifiedDiff(beforeText: string, afterText: string): string {
  const before = diffLines(beforeText)
  const after = diffLines(afterText)
  const n = before.length
  const m = after.length

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] =
        before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }

  const lines: string[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      lines.push(` ${before[i]}`)
      i += 1
      j += 1
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      lines.push(`-${before[i]}`)
      i += 1
    } else {
      lines.push(`+${after[j]}`)
      j += 1
    }
  }
  while (i < n) {
    lines.push(`-${before[i]}`)
    i += 1
  }
  while (j < m) {
    lines.push(`+${after[j]}`)
    j += 1
  }
  return lines.join('\n')
}

/**
 * Grade every path in `base ∪ proposed` and render a unified diff for changed
 * text files. Paths are returned in lexicographic order so the preview is
 * stable across renders.
 *
 * - `added` — in proposed only
 * - `removed` — in base only
 * - `modified` — in both, bytes differ
 * - `unchanged` — in both, bytes identical
 *
 * Binary files (or text↔binary flips) grade normally but carry `diff: null`,
 * matching the registry's `ProposalFileDiff` contract.
 */
export function computeBundleDiff(base: BundleFiles, proposed: BundleFiles): ProposalFileDiff[] {
  const paths = Array.from(new Set([...Object.keys(base), ...Object.keys(proposed)])).sort()

  return paths.map((path) => {
    const baseEntry = base[path]
    const propEntry = proposed[path]

    if (baseEntry && !propEntry) {
      const { binary } = decodeFile(baseEntry)
      return { path, status: 'removed', diff: null, binary }
    }
    if (!baseEntry && propEntry) {
      const decoded = decodeFile(propEntry)
      return {
        path,
        status: 'added',
        diff: decoded.binary ? null : unifiedDiff('', decoded.text ?? ''),
        binary: decoded.binary,
      }
    }

    const b = decodeFile(baseEntry)
    const p = decodeFile(propEntry)
    if (bytesEqual(b.bytes, p.bytes)) {
      return { path, status: 'unchanged', diff: null, binary: b.binary || p.binary }
    }
    const binary = b.binary || p.binary
    return {
      path,
      status: 'modified',
      diff: binary ? null : unifiedDiff(b.text ?? '', p.text ?? ''),
      binary,
    }
  })
}

/** True when the proposed bundle differs from the base in at least one file. */
export function hasBundleChanges(base: BundleFiles, proposed: BundleFiles): boolean {
  return computeBundleDiff(base, proposed).some((d) => d.status !== 'unchanged')
}

/** Read SKILL.md text from a wire bundle (empty string when missing or binary). */
export function skillMdFromBundle(files: BundleFiles): string {
  const entry = files[SKILL_ENTRYPOINT]
  if (!entry) return ''
  const decoded = decodeFile(entry)
  return decoded.text ?? ''
}

// ---------------------------------------------------------------------------
// Multi-file authoring.
//
// A skill is a folder, not a single SKILL.md. These helpers let the browser
// build, mutate, and validate the full wire-format bundle the registry already
// accepts. They mirror the server's `validateBundle` / `assertSafeBundlePath`
// (packages/protocol/src/bundle.ts) so the UI fails fast with the same rules
// the registry enforces, and add web-only affordances (junk filtering on folder
// upload, executable detection for install-time warnings).
// ---------------------------------------------------------------------------

/** §2.1 size caps — kept in sync with packages/protocol/src/bundle.ts. */
export const MAX_BUNDLE_BYTES = 25 * 1024 * 1024
export const MAX_INSTRUCTION_BYTES = 1 * 1024 * 1024

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000 // chunk to keep String.fromCharCode under arg limits
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/**
 * Encode raw bytes into a wire entry. Picks `utf8` when the bytes round-trip
 * cleanly through UTF-8 with no NUL byte (matching `encodeBundle`), else
 * `base64`. The canonical hash is over bytes, so the choice never affects it.
 */
export function entryFromBytes(bytes: Uint8Array): BundleFileEntry {
  if (!bytes.includes(0)) {
    try {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      if (bytesEqual(new TextEncoder().encode(text), bytes)) {
        return { enc: 'utf8', data: text }
      }
    } catch {
      /* not clean UTF-8 — fall through to base64 */
    }
  }
  return { enc: 'base64', data: bytesToBase64(bytes) }
}

/** A text wire entry. */
export function entryFromText(text: string): BundleFileEntry {
  return { enc: 'utf8', data: text }
}

/** Decoded byte length of one entry. */
export function entryByteLength(entry: BundleFileEntry): number {
  return decodeFile(entry).bytes.length
}

/** Human-readable byte size for UI labels. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  // Whole KB — the 0.1 KB precision is noise in a status bar; sub-1 KB files
  // already fall to the `B` branch, so nothing rounds down to a misleading 0.
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Validate a bundle-relative path, returning a human-readable error or `null`.
 * Delegates to `@skillet/protocol` so studio validation matches publish rules.
 */
export function bundlePathError(path: string): string | null {
  return protocolBundlePathError(path)
}

/** Build artifacts and VCS/editor cruft we drop on folder upload. */
const JUNK_SEGMENTS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  '.DS_Store',
  'Thumbs.db',
  '.idea',
  '.vscode',
])

/**
 * True when a path shouldn't ride along in a bundle and isn't worth flagging:
 * a build-artifact / VCS / editor directory, or a dotfile.
 *
 * The wire format forbids a leading-dot *basename* outright (see
 * `assertSafeBundlePath`), so `.gitignore`, `.env`, `.editorconfig` and friends
 * can never be part of a valid bundle. On upload/import we drop them quietly
 * rather than flag each one as an "unsafe path" — that's noise, not a warning.
 * (A dot-*directory* with a normal filename, e.g. `.claude/config.json`, is
 * allowed by the format, so we only match the basename here.)
 */
export function isJunkPath(path: string): boolean {
  const baseName = path.split('/').pop() ?? ''
  if (baseName.startsWith('.')) return true
  return path.split('/').some((seg) => JUNK_SEGMENTS.has(seg))
}

const EXECUTABLE_EXTENSIONS = new Set([
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'sh',
  'bash',
  'zsh',
  'command',
  'bat',
  'cmd',
  'ps1',
  'app',
  'msi',
  'deb',
  'rpm',
  'jar',
  'class',
  'o',
  'a',
])

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()
}

/**
 * Heuristic: does this file look like a script or native executable? We do NOT
 * block these — scripts are the point of folder skills — but we surface a
 * warning so an installer makes an informed choice (the trust model is signing
 * + the approval-gate diff, not content sandboxing).
 */
export function isLikelyExecutable(path: string, bytes: Uint8Array): boolean {
  if (EXECUTABLE_EXTENSIONS.has(extensionOf(path))) return true
  if (bytes.length >= 2 && bytes[0] === 0x23 && bytes[1] === 0x21) return true // shebang
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

export interface BundleValidation {
  /**
   * Hard problems: content that is invalid or unpublishable (unsafe paths, size
   * caps). Surfaced as a banner — something is wrong and needs fixing.
   */
  errors: string[]
  /**
   * Not-yet-ready signals: a draft that simply isn't finished (no SKILL.md at
   * the root, no instructions yet). These keep Publish disabled but are NOT
   * banners — an unfinished draft isn't an error, and a red warning on a page
   * the author just opened is a hostile first impression.
   */
  incomplete: string[]
}

/**
 * Validate a full bundle for publish. `errors` mirror the registry's
 * `validateBundle` (unsafe paths, size caps); `incomplete` are the "keep filling
 * it in" gates (missing SKILL.md, empty instructions).
 *
 * Script/executable files are NOT flagged here: the rail marks them with an
 * `exec` badge, the file view repeats it, installers get an explicit consent
 * prompt before anything runs, and the harm scanner owns the real risk surface.
 * A stack of one-per-file "this looks like a script" banners was pure noise.
 */
export function validateBundleFiles(files: BundleFiles): BundleValidation {
  const errors: string[] = []
  const incomplete: string[] = []

  if (!files[SKILL_ENTRYPOINT]) {
    incomplete.push('A skill must include SKILL.md at the root.')
  }

  let total = 0
  for (const path of Object.keys(files).sort()) {
    const pathErr = bundlePathError(path)
    if (pathErr) errors.push(pathErr)

    const decoded = decodeFile(files[path] as BundleFileEntry)
    total += decoded.bytes.length

    if (path === SKILL_ENTRYPOINT) {
      if (decoded.bytes.length > MAX_INSTRUCTION_BYTES) {
        errors.push(`SKILL.md is too large (max ${formatBytes(MAX_INSTRUCTION_BYTES)}).`)
      }
      // A skill must actually instruct. Frontmatter alone (just a name/slug)
      // with an empty body is not a publishable skill — but it's an unfinished
      // draft, not an error to alarm about.
      const body = decoded.text == null ? '' : splitSkillMdFrontmatter(decoded.text).body
      if (body.trim().length === 0) {
        incomplete.push('Add instructions to SKILL.md: what the skill should do.')
      }
    }
  }

  if (total > MAX_BUNDLE_BYTES) {
    errors.push(
      `Bundle is too large (${formatBytes(total)}; max ${formatBytes(MAX_BUNDLE_BYTES)}).`,
    )
  }

  return { errors, incomplete }
}

/** Add or replace one file in a bundle (returns a new bundle). */
export function setBundleFile(
  files: BundleFiles,
  path: string,
  entry: BundleFileEntry,
): BundleFiles {
  return { ...files, [path]: entry }
}

/** Remove one file from a bundle (returns a new bundle). */
export function removeBundleFile(files: BundleFiles, path: string): BundleFiles {
  const next = { ...files }
  delete next[path]
  return next
}

/** Move a file to a new path, preserving its bytes (returns a new bundle). */
export function renameBundleFile(files: BundleFiles, from: string, to: string): BundleFiles {
  if (from === to || !files[from]) return files
  const next = { ...files }
  next[to] = next[from] as BundleFileEntry
  delete next[from]
  return next
}
