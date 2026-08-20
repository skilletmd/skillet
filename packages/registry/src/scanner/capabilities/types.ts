// Capability data model — a PARALLEL lane to the threat `Finding` pipeline.
//
// Capabilities answer the installer's question ("what can this skill do?"), not
// the publisher's gate ("is this a threat?"). They are an inventory of benign
// AND risky behavior, computed alongside `runScan` but NEVER feeding the
// quarantine rollup. The risky/benign distinction on a capability is a
// JOIN against co-located threat findings (added in U2), not a re-detection.

import { PERMISSION_ORDER } from '@skillet/protocol';

/**
 * Closed set of installer-facing capabilities. Threat `Category` is a separate,
 * threat-shaped union (see ../types.ts) — these two taxonomies are intentionally
 * disjoint and must not be merged. Expanding this set is follow-up work.
 */
export type Capability =
  | 'runs-shell'
  | 'network'
  | 'writes-files'
  | 'deletes-files'
  | 'reads-secrets'
  | 'install-hooks'
  | 'connects-mcp-server'
  | 'executes-generated'
  | 'injects-output-content';

/**
 * The single canonical chip order, shared by every capability surface (a skill's
 * manifest AND a kit's union of member capabilities). Sorting collector output
 * by this guarantees the chips read identically skill-side and kit-side. The
 * canonical home is now `@skillet/protocol`'s `PERMISSION_ORDER` (the shared scan
 * vocabulary) — registry and web both import it, so there is one source of truth
 * instead of three hand-mirrored copies. This is the declaration order of
 * {@link Capability}, most-impactful-first.
 */
export const CAPABILITY_ORDER: readonly Capability[] = PERMISSION_ORDER as readonly Capability[];

// Compile-time exhaustiveness guard (types only — erased at runtime). The order
// is sourced from the protocol's PERMISSION_ORDER, whose element type is the
// canonical id union. Asserting Capability and that union are mutually
// assignable means adding a Capability without ordering it in PERMISSION_ORDER
// (or the reverse) is a TS error here, not a silently-dropped capability.
type _OrderedCapability = (typeof PERMISSION_ORDER)[number];
type _Assert<A extends B, B> = A;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time PERMISSION_ORDER sync
type _CapsAreOrdered = _Assert<Capability, _OrderedCapability>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- compile-time PERMISSION_ORDER sync
type _OrderedAreCaps = _Assert<_OrderedCapability, Capability>;

/**
 * A single location where a capability was observed. `source` distinguishes
 * capability derived from executable scripts (`code`) vs SKILL.md / markdown
 * instruction prose (`instructions`); it is assigned by the collector from the
 * file type, not by the detector.
 */
export interface CapabilityEvidence {
  file: string;
  lineStart: number;
  lineEnd: number;
  source: 'code' | 'instructions';
}

/**
 * One aggregated entry per distinct capability. `risky` is the threat-finding
 * join (false until U2 wires it); `evidence` is the merged, deduped location
 * list.
 */
export interface CapabilityEntry {
  capability: Capability;
  risky: boolean;
  evidence: CapabilityEvidence[];
}

/**
 * The full capability inventory for a bundle.
 *
 * `analysis` is the trust qualifier on an EMPTY manifest — and the core safety
 * signal. It is NOT about how many capabilities were found; it is about
 * whether everything executable was actually looked at:
 *   - `'full'`    → every executable-shaped file in the bundle was inspected, so
 *     an empty `capabilities` is a real "nothing detected".
 *   - `'partial'` → at least one executable-shaped file went UN-inspected (a
 *     language with no detector like .rb/.go/.rs, an oversized file skipped by
 *     the input cap, or a script-shaped file that decoded as binary). An empty
 *     `capabilities` then means "nothing found in what we COULD read" — never
 *     "this skill is inert". The installer UI must surface that distinction.
 * A non-empty manifest can still be `'partial'` (some files inspected, some not).
 */
export interface CapabilityReport {
  capabilities: CapabilityEntry[];
  analysis: 'full' | 'partial';
  /** The un-inspected file paths behind a `'partial'` analysis (binary-shaped,
   *  oversized, or unsupported-language). Empty when `analysis` is `'full'`.
   *  Surfaced to the installer UI as the "Unscanned files" list. */
  blindSpots: string[];
}

/**
 * Runtime contract for a capability detector: a pure function over a single
 * text file, mirroring the threat `Detector` purity contract (no IO, no state).
 *
 * A detector reports WHICH capability it saw and WHERE (line band) — it does
 * NOT assign `source` (the collector derives that from the file type) and does
 * NOT decide `risky` (that is the U2 threat-finding join). U2 (code) and U3
 * (prose) detectors implement this contract.
 */
export type CapabilityDetector = (
  filePath: string,
  contents: string,
) => Array<{ capability: Capability; lineStart: number; lineEnd: number }>;
