// Skill bundle — wire format (§2.1) + canonical content hash (§2.2).
//
// A skill is a folder tree, not a single file. The bundle is a map of
// POSIX-relative paths to per-file encoded content; `enc: utf8|base64`.
// Binary is first-class. The canonical hash is over decoded bytes so the
// transport encoding cannot change the result.

import { createHash } from 'node:crypto';

export type BundleEncoding = 'utf8' | 'base64';

export interface BundleFileEntry {
  enc: BundleEncoding;
  data: string;
}

/** Wire-format bundle: path → { enc, data }. */
export type BundleFiles = Record<string, BundleFileEntry>;

/** Decoded bundle: path → raw bytes. The canonical hash operates on this. */
export type DecodedBundle = Map<string, Uint8Array>;

export const CONTENT_HASH_PREFIX = 'sha256:';

// §2.1 size rules.
export const MAX_BUNDLE_BYTES = 25 * 1024 * 1024;
export const MAX_INSTRUCTION_BYTES = 1 * 1024 * 1024;

// §2.1: SKILL.md MUST be at the root.
export const SKILL_ENTRYPOINT = 'SKILL.md';

/** Suffix for ephemeral atomic-write backups; never part of skill content. */
export const SKILLET_BACKUP_SUFFIX = '.skillet-backup';

export function isSkilletBackupPath(path: string): boolean {
  return path.endsWith(SKILLET_BACKUP_SUFFIX);
}

export class BundleError extends Error {
  /** Machine-readable error code per protocol §0. */
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'BundleError';
  }
}

/**
 * Decode a wire-format bundle into a path → bytes map.
 *
 * - Validates that each entry has a recognized `enc` field.
 * - Does NOT validate paths or sizes (use `validateBundle`).
 */
export function decodeBundle(files: BundleFiles): DecodedBundle {
  const out = new Map<string, Uint8Array>();
  for (const [path, entry] of Object.entries(files)) {
    if (entry == null || typeof entry !== 'object') {
      throw new BundleError('unsafe_path', `Bundle entry for "${path}" is not an object`);
    }
    if (entry.enc === 'utf8') {
      out.set(path, Buffer.from(entry.data, 'utf8'));
    } else if (entry.enc === 'base64') {
      // strict: reject non-canonical base64 (whitespace, padding errors)
      const buf = Buffer.from(entry.data, 'base64');
      // round-trip check — Node's base64 decoder is lenient; we want strict to
      // avoid hash mismatches where two different `data` strings decode to the
      // same bytes (only canonical base64 round-trips).
      if (buf.toString('base64') !== entry.data) {
        throw new BundleError(
          'unsafe_path',
          `Bundle entry for "${path}" has non-canonical base64 data`,
        );
      }
      out.set(path, buf);
    } else {
      throw new BundleError(
        'unsafe_path',
        `Bundle entry for "${path}" has unsupported enc: ${String((entry as { enc: unknown }).enc)}`,
      );
    }
  }
  return out;
}

/**
 * Encode a decoded bundle into wire format.
 *
 * Picks `utf8` when the bytes round-trip cleanly through UTF-8 (no replacement
 * characters), otherwise falls back to `base64`. The canonical hash is over
 * the raw bytes either way, so this choice never affects integrity.
 */
export function encodeBundle(bundle: DecodedBundle): BundleFiles {
  const out = Object.create(null) as BundleFiles;
  for (const [path, bytes] of bundle) {
    const buf = Buffer.from(bytes);
    const asUtf8 = buf.toString('utf8');
    const roundTrip = Buffer.from(asUtf8, 'utf8');
    if (roundTrip.equals(buf)) {
      out[path] = { enc: 'utf8', data: asUtf8 };
    } else {
      out[path] = { enc: 'base64', data: buf.toString('base64') };
    }
  }
  return out;
}

/**
 * Canonical content hash per §2.2:
 *
 *   sha256( for each path in lexicographic byte order:
 *             u64be(len(utf8(path))) || utf8(path) ||
 *             u64be(len(content))    || raw_content_bytes )
 *
 * prefixed with `sha256:`. Deterministic across implementations: identical
 * bytes hash identically regardless of how they arrived on the wire.
 *
 * Each field is LENGTH-PREFIXED with a fixed-width 8-byte big-endian count, so
 * no content byte can be mistaken for a delimiter. The previous scheme used an
 * in-band `0x00` separator; because content can itself contain `0x00` (bundles
 * carry binary files), two different file sets could frame to the same byte
 * stream and collide. Length prefixing makes the framing unambiguous.
 */
/** Drop ephemeral `.skillet-backup` paths before hashing skill bytes. */
export function stripSkilletBackupPaths(bundle: DecodedBundle): DecodedBundle {
  const out = new Map<string, Uint8Array>();
  for (const [path, bytes] of bundle) {
    if (!isSkilletBackupPath(path)) out.set(path, bytes);
  }
  return out;
}

export function canonicalContentHash(bundle: DecodedBundle): string {
  const hash = createHash('sha256');
  const paths = [...bundle.keys()].sort(comparePathBytes);
  for (const path of paths) {
    const pathBytes = Buffer.from(path, 'utf8');
    const data = bundle.get(path);
    const content = data == null ? EMPTY_BYTES : Buffer.from(data);
    hash.update(u64be(pathBytes.length));
    hash.update(pathBytes);
    hash.update(u64be(content.length));
    hash.update(content);
  }
  return CONTENT_HASH_PREFIX + hash.digest('hex');
}

/**
 * Canonical hash of publishable skill content. Excludes `.skillet-backup` paths
 * so local store reads (which skip those files) align with `entry.hash`.
 */
export function skillContentHash(bundle: DecodedBundle): string {
  return canonicalContentHash(stripSkilletBackupPaths(bundle));
}

const EMPTY_BYTES = Buffer.alloc(0);

/** Fixed-width 8-byte big-endian length prefix (BigUInt64BE). */
function u64be(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b;
}

/** Lexicographic byte order (NOT JS string comparison, which is by UTF-16 code unit). */
function comparePathBytes(a: string, b: string): number {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return Buffer.compare(ba, bb);
}

/**
 * Validate bundle paths and sizes per §2.1.
 *
 * Rejects:
 * - missing `SKILL.md` at the bundle root (`unsafe_path` — bundle invariant).
 * - absolute paths, paths containing `.` or `..` segments, backslashes,
 *   leading slash, trailing slash, empty segments, null bytes, or non-POSIX
 *   separators (`unsafe_path`).
 * - bundle total > 25 MB (`bundle_too_large`).
 * - instruction closure total > 1 MB (`instruction_too_large`).
 *
 * Note: symlinks cannot appear inside a Map<path, bytes> directly — the
 * filesystem walker (`readBundleFromDir`) rejects them before this point.
 */
export function validateBundle(bundle: DecodedBundle): void {
  if (!bundle.has(SKILL_ENTRYPOINT)) {
    throw new BundleError('unsafe_path', 'Bundle missing required SKILL.md at root');
  }

  let totalBytes = 0;

  for (const [path, data] of bundle) {
    assertSafeBundlePath(path);
    totalBytes += data.byteLength;
  }

  if (totalBytes > MAX_BUNDLE_BYTES) {
    throw new BundleError(
      'bundle_too_large',
      `Bundle is ${totalBytes} bytes; max is ${MAX_BUNDLE_BYTES}`,
    );
  }

  const instructionBytes = instructionClosureBytes(bundle);
  if (instructionBytes > MAX_INSTRUCTION_BYTES) {
    throw new BundleError(
      'instruction_too_large',
      `Instruction closure is ${instructionBytes} bytes; max is ${MAX_INSTRUCTION_BYTES}`,
    );
  }
}

/**
 * Validate a bundle path, returning a human-readable error or `null` when safe.
 * Mirrors `assertSafeBundlePath` for client-side editors.
 */
export function bundlePathError(path: string): string | null {
  try {
    assertSafeBundlePath(path);
    return null;
  } catch (err) {
    if (err instanceof BundleError) return err.message;
    throw err;
  }
}

/**
 * Reject any path the bundle wire format does not accept.
 *
 * The bundle is rooted at the skill directory and uses POSIX separators only.
 * A path failing this rejects the whole publish (§2.1).
 */
export function assertSafeBundlePath(path: string): void {
  if (path.length === 0) {
    throw new BundleError('unsafe_path', 'Bundle path is empty');
  }
  if (path.includes('\0')) {
    throw new BundleError('unsafe_path', `Bundle path contains null byte: ${JSON.stringify(path)}`);
  }
  if (path.includes('\\')) {
    throw new BundleError(
      'unsafe_path',
      `Bundle path uses Windows separator (\\): ${JSON.stringify(path)}`,
    );
  }
  if (path.startsWith('/')) {
    throw new BundleError('unsafe_path', `Bundle path is absolute: ${JSON.stringify(path)}`);
  }
  if (path.endsWith('/')) {
    throw new BundleError('unsafe_path', `Bundle path ends with separator: ${JSON.stringify(path)}`);
  }
  const segments = path.split('/');
  for (const seg of segments) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new BundleError('unsafe_path', `Bundle path has unsafe segment: ${JSON.stringify(path)}`);
    }
  }
  if (segments.includes('.git')) {
    throw new BundleError(
      'unsafe_path',
      `Bundle path includes .git: ${JSON.stringify(path)}`,
    );
  }
  const baseName = segments[segments.length - 1]!;
  if (baseName.startsWith('.')) {
    throw new BundleError(
      'unsafe_path',
      `Bundle path is a dotfile: ${JSON.stringify(path)}`,
    );
  }
  if (baseName === '__proto__' || baseName === '.DS_Store') {
    throw new BundleError(
      'unsafe_path',
      `Bundle path uses a reserved name: ${JSON.stringify(path)}`,
    );
  }
  const blockedConfigNames = new Set([
    'settings.json',
    'mcp.json',
    'claude_desktop_config.json',
    'hooks.json',
    '.cursorrules',
  ]);
  if (blockedConfigNames.has(baseName)) {
    throw new BundleError(
      'unsafe_path',
      `Bundle path is a blocked runtime-control filename: ${JSON.stringify(path)}`,
    );
  }
  if (segments.includes('hooks')) {
    throw new BundleError(
      'unsafe_path',
      `Bundle path includes a hooks directory: ${JSON.stringify(path)}`,
    );
  }
  if (segments[0] === '.claude' || segments[0] === '.cursor') {
    throw new BundleError(
      'unsafe_path',
      `Bundle path targets a hidden agent config directory: ${JSON.stringify(path)}`,
    );
  }
}

/**
 * v1 instruction-file classification (legacy interim heuristic).
 *
 * @deprecated Budget enforcement uses {@link computeInstructionClosure}.
 * Kept for callers that still classify paths by directory during the transition.
 */
export function isInstructionPath(path: string): boolean {
  if (path === SKILL_ENTRYPOINT) return true;
  if (path.startsWith('agents/') && /\.(md|markdown|txt)$/i.test(path)) return true;
  return false;
}

/** Extract YAML frontmatter from a markdown file body, or null if absent. */
export function extractFrontmatterYaml(text: string): string | null {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match?.[1] ?? null;
}

/** Parse a `required_reading:` list from a frontmatter YAML block. */
export function parseRequiredReadingFromYaml(yaml: string): string[] {
  const items: string[] = [];
  let inBlock = false;

  for (const line of yaml.split('\n')) {
    if (/^required_reading:\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      const itemMatch = line.match(/^\s+-\s+(?:"([^"]*)"|'([^']*)'|(.+))\s*$/);
      if (itemMatch) {
        const raw = (itemMatch[1] ?? itemMatch[2] ?? itemMatch[3] ?? '').trim();
        if (raw) items.push(raw);
        continue;
      }
      if (/^\S/.test(line)) {
        inBlock = false;
      }
    }
  }

  return items;
}

function decodeBundleText(bundle: DecodedBundle, path: string): string {
  const bytes = bundle.get(path);
  if (!bytes) return '';
  return Buffer.from(bytes).toString('utf8');
}

function requiredReadingForPath(bundle: DecodedBundle, path: string): string[] {
  const yaml = extractFrontmatterYaml(decodeBundleText(bundle, path));
  if (!yaml) return [];
  return parseRequiredReadingFromYaml(yaml);
}

function assertSafeGlobPattern(pattern: string): void {
  const MAX_GLOB_LEN = 128;
  const MAX_GLOB_STARS = 24;
  if (pattern.length > MAX_GLOB_LEN) {
    throw new BundleError('unsafe_path', `required_reading glob exceeds ${MAX_GLOB_LEN} characters`);
  }
  if ((pattern.match(/\*/g) ?? []).length > MAX_GLOB_STARS) {
    throw new BundleError('unsafe_path', `required_reading glob has too many wildcards`);
  }
  if (pattern.length === 0) {
    throw new BundleError('unsafe_path', 'required_reading glob is empty');
  }
  if (pattern.includes('\0') || pattern.includes('\\') || pattern.startsWith('/')) {
    throw new BundleError('unsafe_path', `required_reading glob is unsafe: ${JSON.stringify(pattern)}`);
  }
  for (const seg of pattern.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') {
      throw new BundleError('unsafe_path', `required_reading glob has unsafe segment: ${JSON.stringify(pattern)}`);
    }
  }
}

/** Turn a bundle-relative POSIX glob into a RegExp anchored to the full path. */
export function globPatternToRegExp(pattern: string): RegExp {
  let re = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i += 1;
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if (/[+^${}()|[\]\\.]/.test(ch)) {
      re += `\\${ch}`;
    } else {
      re += ch;
    }
  }
  re += '$';
  return new RegExp(re);
}

function resolveGlobAgainstManifest(pattern: string, manifest: readonly string[]): string[] {
  assertSafeGlobPattern(pattern);
  const re = globPatternToRegExp(pattern);
  return [...new Set(manifest.filter((p) => re.test(p)))].sort();
}

/**
 * Instruction closure: SKILL.md plus every bundle path
 * reachable via transitive `required_reading` frontmatter.
 */
export function computeInstructionClosure(bundle: DecodedBundle): Set<string> {
  if (!bundle.has(SKILL_ENTRYPOINT)) {
    throw new BundleError('unsafe_path', 'Bundle missing required SKILL.md at root');
  }

  const manifest = [...bundle.keys()].sort();
  const closure = new Set<string>();
  const work: string[] = [SKILL_ENTRYPOINT];

  while (work.length > 0) {
    const file = work.pop()!;
    if (closure.has(file)) continue;

    if (!bundle.has(file)) {
      throw new BundleError(
        'unsafe_path',
        `required_reading references missing bundle path: ${JSON.stringify(file)}`,
      );
    }
    assertSafeBundlePath(file);
    closure.add(file);

    for (const pattern of requiredReadingForPath(bundle, file)) {
      const matches = resolveGlobAgainstManifest(pattern, manifest);
      if (matches.length === 0 && !pattern.includes('*') && !pattern.includes('?')) {
        throw new BundleError(
          'unsafe_path',
          `required_reading path not found in bundle: ${JSON.stringify(pattern)}`,
        );
      }
      for (const path of matches) {
        if (!closure.has(path)) work.push(path);
      }
    }
  }

  return closure;
}

/** Sum decoded bytes over the instruction closure. */
export function instructionClosureBytes(bundle: DecodedBundle): number {
  let total = 0;
  for (const path of computeInstructionClosure(bundle)) {
    total += bundle.get(path)?.byteLength ?? 0;
  }
  return total;
}
