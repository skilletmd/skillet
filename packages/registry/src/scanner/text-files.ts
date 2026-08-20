// Identifies which bundle entries are text (scanner input) vs binary (skipped).
//
// We prefer extension allowlist + UTF-8 round-trip over magic-byte sniffing —
// detectors only need the text-shaped categories the spec calls out (markdown,
// scripts, source, config). Binaries are not skipped silently: they are hashed
// and recorded as untouched-by-scan so a future image-based exfil detector can
// be added without changing the publish pipeline.

// The text-extension / text-basename allowlist lives in the central file-classes
// primitive (alongside the markdown/script/inert taxonomy), edited in one place.
import { isTextExtension } from './file-classes.js';

/**
 * Decision boundary between text and binary. A bundle entry that fails the
 * extension/name allowlist but has no NUL bytes and decodes cleanly as UTF-8
 * is treated as text — so `SKILL.notes` or `agents/foo` (no extension) still
 * get scanned.
 */
export function isTextFile(path: string, bytes: Uint8Array): boolean {
  if (isTextExtension(path)) return true;

  // Probe the first 8KB only — gating cost stays bounded regardless of size.
  const sample = bytes.subarray(0, Math.min(bytes.length, 8192));
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) return false;
  }
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(sample);
    // Heuristic: at least 90% printable / whitespace, else likely binary.
    let printable = 0;
    for (const ch of decoded) {
      const cp = ch.codePointAt(0)!;
      const isPrint =
        cp === 0x09 || cp === 0x0a || cp === 0x0d || (cp >= 0x20 && cp <= 0x7e) || cp >= 0xa0;
      if (isPrint) printable++;
    }
    return printable / decoded.length >= 0.9;
  } catch {
    return false;
  }
}

/**
 * Decode a known-text bundle entry to UTF-8 with replacement on invalid bytes,
 * so a detector run never throws on a borderline file already classified as
 * text. The bundle hash is computed over raw bytes upstream, so replacement
 * here cannot drift identity.
 */
export function decodeText(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

/** Fatal UTF-8 decode — used to detect malformed bytes, not to gate scanning. */
export function decodeTextForScan(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** True when the raw bytes are not well-formed UTF-8. */
export function hasInvalidUtf8(bytes: Uint8Array): boolean {
  try {
    decodeTextForScan(bytes);
    return false;
  } catch {
    return true;
  }
}
