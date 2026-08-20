// Single-pass scan engine: walk a decoded bundle ONCE, decode each text file
// ONCE, and run both detector families over it. Replaces the two separate walks
// (scanner.ts `runScan` + capabilities/collector.ts `runCapabilityScan`).
//
// The two families have the SAME input shape `(filePath, contents) => results`
// but different per-file policy, both preserved here exactly:
//   - Threat detectors run on every text file up to MAX_DETECT_BYTES of decoded
//     text (prefix scan when larger — bounds ReDoS cost on the publish path).
//   - Capability detectors run only on text files at or under MAX_DETECT_BYTES;
//     oversized/binary files are left un-inspected (the collector turns that into
//     a blind spot / `partial`).
// Decoding uses the lenient decoder so invalid UTF-8 cannot skip threat
// detectors; malformed bytes are recorded for blind-spot / quarantine policy.
//
// Fault isolation (was structural — two top-level calls): a throw in ONE detector
// is contained per-detector here, so a buggy capability detector can never fail
// the threat scan or block publish, and vice-versa. The walk always completes.
//
// The engine is policy-free about blind spots and evidence `source`: it returns
// the raw findings, the raw capability hits (with their file), and a per-file
// capability disposition list IN SORTED PATH ORDER so the collector applies its
// own `isInertShape` / `isUninspectedBlindSpot` rules and reproduces the exact
// `blindSpots` ordering.

import type { DecodedBundle } from '@skillet/protocol';
import { isSkilletBackupPath } from '@skillet/protocol';
import { decodeText, hasInvalidUtf8, isTextFile } from './text-files.js';
import {
  isExtensionlessInstructionPath,
  isMarkdownFile,
  isCoveredByDetector,
  effectiveScriptPath,
} from './file-classes.js';
import type { Detector, Finding } from './types.js';
import type { Capability, CapabilityDetector } from './capabilities/types.js';

/** Per-file input cap for decoded text. Threat detectors scan a prefix at most
 *  this wide; capability detectors skip files larger than this. */
export const MAX_DETECT_BYTES = 1024 * 1024;

export type FileSkipReason = 'binary' | 'oversized' | 'decode_failed';

/** One raw capability hit, tagged with the file it came from. */
export interface CapabilityHit {
  file: string;
  capability: Capability;
  lineStart: number;
  lineEnd: number;
}

/** Per-file capability disposition, emitted in sorted path order. `inspected` is
 *  false for binary, oversized, or decode-failed files; true with `hitCount` for
 *  text files at/under the cap. The collector folds this into its blind-spot
 *  rules without re-walking the bundle. */
export interface CapabilityFileDisposition {
  path: string;
  inspected: boolean;
  hitCount: number;
  /** True when a registered detector covers this file's shape (by extension, or
   *  by an extensionless script's resolved shebang interpreter). An inspected,
   *  zero-hit file that is NOT covered is a blind spot. Set only for inspected
   *  files; absent (falsy) on skipped ones, which route through `isInertShape`. */
  covered?: boolean;
  skipReason?: FileSkipReason;
}

export interface ScanEngineResult {
  /** Threat findings from every text file (any size). */
  findings: Finding[];
  /** Raw capability hits from text files at/under the cap. */
  capabilityHits: CapabilityHit[];
  /** Per-file capability disposition, sorted-path order, for blind-spot analysis. */
  capabilityFiles: CapabilityFileDisposition[];
}

export interface ScanEngineOptions {
  threatDetectors?: ReadonlyArray<Detector>;
  capabilityDetectors?: ReadonlyArray<CapabilityDetector>;
}

function malformedUtf8Finding(path: string): Finding {
  return {
    category: 'obfuscation',
    confidence: 'high',
    file: path,
    lineStart: 1,
    lineEnd: 1,
    snippet: '(invalid UTF-8)',
    why: 'obfuscation:invalid-utf8',
  };
}

function isInstructionShapedPath(path: string): boolean {
  return isMarkdownFile(path) || isExtensionlessInstructionPath(path);
}

function pushDisposition(
  capabilityFiles: CapabilityFileDisposition[],
  disposition: CapabilityFileDisposition,
): void {
  capabilityFiles.push(disposition);
}

/**
 * Walk the bundle once and run the provided detector families. Pass only the
 * threat family for a threat-only scan, only the capability family for a
 * capabilities-only recompute (the backfill path), or both for a full scan — the
 * single walk is the win.
 */
export function scanBundle(bundle: DecodedBundle, opts: ScanEngineOptions = {}): ScanEngineResult {
  const threatDetectors = opts.threatDetectors ?? [];
  const capabilityDetectors = opts.capabilityDetectors ?? [];
  const runCapabilities = opts.capabilityDetectors !== undefined;

  const findings: Finding[] = [];
  const capabilityHits: CapabilityHit[] = [];
  const capabilityFiles: CapabilityFileDisposition[] = [];

  const paths = [...bundle.keys()].sort();
  for (const path of paths) {
    if (isSkilletBackupPath(path)) continue;
    const bytes = bundle.get(path)!;

    if (!isTextFile(path, bytes)) {
      if (runCapabilities) {
        pushDisposition(capabilityFiles, {
          path,
          inspected: false,
          hitCount: 0,
          skipReason: 'binary',
        });
      }
      continue;
    }

    const invalidUtf8 = hasInvalidUtf8(bytes);
    const oversized = bytes.length > MAX_DETECT_BYTES;
    const contents = decodeText(bytes);
    const threatInput =
      contents.length > MAX_DETECT_BYTES ? contents.slice(0, MAX_DETECT_BYTES) : contents;
    // Classification handle: an extensionless shebang script resolves to its
    // interpreter extension so language-keyed detectors and coverage dispatch on
    // it. Detectors classify by `classPath` but every reported path is the real
    // `path` (findings are remapped below; hits/dispositions use `path` directly).
    const classPath = effectiveScriptPath(path, contents);

    const findingsBefore = findings.length;
    for (const detect of threatDetectors) {
      try {
        for (const f of detect(classPath, threatInput)) {
          findings.push(classPath === path ? f : { ...f, file: path });
        }
      } catch {
        // Per-detector isolation: a thrown threat detector contributes nothing
        // and never aborts the walk or the other family.
      }
    }

    if (
      invalidUtf8 &&
      findings.length === findingsBefore &&
      isInstructionShapedPath(path)
    ) {
      findings.push(malformedUtf8Finding(path));
    }

    if (runCapabilities) {
      if (invalidUtf8) {
        pushDisposition(capabilityFiles, {
          path,
          inspected: false,
          hitCount: 0,
          skipReason: 'decode_failed',
        });
      } else if (oversized) {
        pushDisposition(capabilityFiles, {
          path,
          inspected: false,
          hitCount: 0,
          skipReason: 'oversized',
        });
      } else {
        let hitCount = 0;
        for (const detect of capabilityDetectors) {
          try {
            for (const hit of detect(classPath, contents)) {
              hitCount++;
              capabilityHits.push({
                file: path,
                capability: hit.capability,
                lineStart: hit.lineStart,
                lineEnd: hit.lineEnd,
              });
            }
          } catch {
            // Per-detector isolation (best-effort capability scan).
          }
        }
        pushDisposition(capabilityFiles, {
          path,
          inspected: true,
          hitCount,
          covered: isCoveredByDetector(classPath),
        });
      }
    } else if (invalidUtf8) {
      // Threat-only path still records decode failures so they are never invisible.
      pushDisposition(capabilityFiles, {
        path,
        inspected: false,
        hitCount: 0,
        skipReason: 'decode_failed',
      });
    }
  }

  return { findings, capabilityHits, capabilityFiles };
}
