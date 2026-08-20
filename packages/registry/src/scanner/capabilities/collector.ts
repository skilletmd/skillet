// Parallel capability collector — runs alongside `runScan` but stays entirely
// out of the threat pipeline: it never imports `runScan`/detectors and
// never touches `rollupStatus`/`weighByFileRole`.
//
// Like `runScan`, it iterates the text-file subset of a decoded bundle once,
// runs each injected detector per file, and aggregates raw hits into one
// `CapabilityEntry` per distinct capability with a deduped evidence list.
//
// Pure: no IO, no clock, deterministic for a given (bundle, detectors).

import type { DecodedBundle } from '@skillet/protocol';
// File taxonomy (markdown/covered/inert) comes from the central primitive so the
// blind-spot rule can't drift from what the detectors actually inspect.
import { isInertShape, isMarkdownFile } from '../file-classes.js';
// The bundle walk + decode + per-file disposition come from the shared engine;
// the collector keeps only the capability-specific aggregation + blind-spot policy.
import {
  scanBundle,
  type CapabilityHit,
  type CapabilityFileDisposition,
} from '../scan-engine.js';
import {
  CAPABILITY_ORDER,
  type Capability,
  type CapabilityDetector,
  type CapabilityEntry,
  type CapabilityEvidence,
  type CapabilityReport,
} from './types.js';

/**
 * SKILL.md and markdown are the instruction (prose) surface; everything else is
 * treated as code. This mirrors the `isScriptFile`/markdown split the threat
 * detectors use (code-shape detectors skip `.md`, prose detectors run there),
 * but here it only decides the evidence `source` tag — the collector still runs
 * every detector over every text file and lets the detector decide what fires.
 */
function evidenceSource(file: string): CapabilityEvidence['source'] {
  return isMarkdownFile(file) ? 'instructions' : 'code';
}

// --- partial-analysis blind-spot detection -----------------------
// The collector must distinguish "inspected and found nothing" from "could not
// inspect". The trust rule is an ALLOWLIST, not a denylist: an enumerated
// list of executable extensions can never be complete. Instead we trust only
// files a registered detector inspected (`isCoveredByDetector`) or files whose
// shape is clearly-inert data/doc/media (`isInertShape`) — both from the central
// file-classes primitive. ANYTHING else that produced zero hits is an
// un-inspected blind spot → the report degrades to `partial`. Adding a detector
// for a new language means editing the covered set in file-classes.ts (one place).

/**
 * An INSPECTED, zero-hit file is a blind spot unless a detector covers its shape
 * or the shape is clearly-inert data/doc/media. `covered` comes from the engine's
 * per-file disposition (extension OR an extensionless script's resolved shebang),
 * so this stays in lockstep with what the detectors actually dispatched on — the
 * default for an unknown code shape is "blind spot", never a false "inert".
 */
function isInspectedBlindSpot(f: CapabilityFileDisposition): boolean {
  return !f.covered && !isInertShape(f.path);
}

/**
 * Run the capability scan over a decoded bundle.
 *
 * `detectors` is injectable so U2 (code) and U3 (prose) can register detectors
 * without the collector importing them yet — the U1 default is an empty list.
 *
 * Aggregation:
 *  - one `CapabilityEntry` per distinct capability that fired anywhere,
 *  - evidence merged across files/detectors and deduped on
 *    (file, lineStart, lineEnd, source),
 *  - capabilities and their evidence emitted in a stable, sorted order.
 *
 * `risky` defaults to `false`. The threat-finding join is a U2 seam: pass
 * `riskyFindings` (the co-located threat findings) and the collector will flip a
 * capability to `risky: true` when one of its evidence locations overlaps a
 * finding's file + line band. Until U2 wires that, every capability is benign.
 */
export function runCapabilityScan(
  bundle: DecodedBundle,
  detectors: CapabilityDetector[] = [],
  // --- U2 SEAM: threat-finding join -------------------------------------
  // U2 will pass the bundle's threat findings here (the {file,lineStart,lineEnd}
  // shape of scan `Finding`). `risky` is set by overlap, NOT by
  // re-detection, so risk styling is a join over the existing threat pipeline.
  riskyFindings: ReadonlyArray<{ file: string; lineStart: number; lineEnd: number }> = [],
): CapabilityReport {
  // One walk in the engine; the collector keeps the capability-specific work.
  const { capabilityHits, capabilityFiles } = scanBundle(bundle, {
    capabilityDetectors: detectors,
  });
  return aggregateCapabilities(capabilityHits, capabilityFiles, riskyFindings);
}

/**
 * Aggregate the engine's raw capability output into a {@link CapabilityReport}:
 * dedup evidence + tag source, derive blind spots from the per-file disposition,
 * and join threat findings for the `risky` flag. Split out of
 * {@link runCapabilityScan} so the combined single-walk scan (runner) can reuse
 * it on hits the engine already produced.
 */
export function aggregateCapabilities(
  capabilityHits: ReadonlyArray<CapabilityHit>,
  capabilityFiles: ReadonlyArray<CapabilityFileDisposition>,
  riskyFindings: ReadonlyArray<{ file: string; lineStart: number; lineEnd: number }> = [],
): CapabilityReport {
  // capability -> deduped evidence, keyed by an evidence identity string. Hits
  // arrive in sorted-path / detector order, so dedup + downstream sort are stable.
  const byCapability = new Map<Capability, Map<string, CapabilityEvidence>>();
  for (const hit of capabilityHits) {
    const source = evidenceSource(hit.file);
    const evidence: CapabilityEvidence = {
      file: hit.file,
      lineStart: hit.lineStart,
      lineEnd: hit.lineEnd,
      source,
    };
    const key = `${hit.file} ${hit.lineStart} ${hit.lineEnd} ${source}`;
    let bucket = byCapability.get(hit.capability);
    if (!bucket) {
      bucket = new Map();
      byCapability.set(hit.capability, bucket);
    }
    // Identical (file,line,source) hits dedup to a single evidence item.
    if (!bucket.has(key)) bucket.set(key, evidence);
  }

  // Blind-spot rule over the engine's per-file disposition, in sorted
  // order: an un-inspected file (binary or oversized) is a blind spot unless its
  // shape is known-inert; an inspected, zero-hit file is a blind spot only when no
  // detector covers it (an unknown code shape) — a covered-but-empty file stays
  // full. `partial` flips the moment any executable-shaped file goes un-inspected.
  let partial = false;
  const blindSpots: string[] = [];
  for (const f of capabilityFiles) {
    if (!f.inspected) {
      // Decode failures on instruction-shaped files are never "inert" — the trust
      // surface must not read fully inspected when bytes were malformed.
      if (f.skipReason === 'decode_failed' || !isInertShape(f.path)) {
        partial = true;
        blindSpots.push(f.path);
      }
    } else if (f.hitCount === 0 && isInspectedBlindSpot(f)) {
      partial = true;
      blindSpots.push(f.path);
    }
  }

  const orderIndex = (c: Capability) => CAPABILITY_ORDER.indexOf(c);
  const capabilities: CapabilityEntry[] = [...byCapability.entries()]
    .sort(([a], [b]) => orderIndex(a) - orderIndex(b))
    .map(([capability, bucket]) => {
      const evidence = [...bucket.values()].sort(
        (a, b) =>
          a.file.localeCompare(b.file) ||
          a.lineStart - b.lineStart ||
          a.lineEnd - b.lineEnd,
      );
      // U2 SEAM: a capability is risky when any evidence location overlaps a
      // co-located threat finding's line band in the same file.
      const risky = evidence.some((e) =>
        riskyFindings.some(
          (f) =>
            f.file === e.file &&
            f.lineStart <= e.lineEnd &&
            f.lineEnd >= e.lineStart,
        ),
      );
      return { capability, risky, evidence };
    });

  return { capabilities, analysis: partial ? 'partial' : 'full', blindSpots };
}
