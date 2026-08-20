// Server-side scan types.
//
// Findings are emitted by individual detectors and aggregated into an overall
// scan status. The status alone (`clean`/`flagged`/`quarantined`/`pending`) is
// what gates serve-time behavior; the findings list carries the why.

import type { Capability } from './capabilities/types.js';

export type Severity = 'low' | 'medium' | 'high';

// Detector taxonomy. The original five (injection, exfil, destructive,
// obfuscation, secret) are joined by additional threat and hygiene categories:
// prompt-leak, privilege-escalation, supply-chain, excessive-agency,
// output-handling, memory-poisoning, tool-misuse, rogue-agent, dependency
// (CVE lookups via OSV.dev), and risky-call (AST exec/eval/subprocess).
// Deeper analyses — taint tracking, binary/YARA signatures, MCP-manifest
// inspection — need dataflow/signature engines and remain future work.
export type Category =
  | 'injection'
  | 'exfil'
  | 'destructive'
  | 'obfuscation'
  | 'secret'
  | 'prompt-leak'
  | 'privilege-escalation'
  | 'supply-chain'
  | 'excessive-agency'
  | 'output-handling'
  | 'memory-poisoning'
  | 'tool-misuse'
  | 'rogue-agent'
  | 'risky-call'
  | 'output-injection';

export interface Finding {
  category: Category;
  confidence: Severity;
  file: string;
  lineStart: number;
  lineEnd: number;
  /** Truncated excerpt (≤120 chars). Detectors must never emit full secrets. */
  snippet: string;
  /** Detector identifier — `category:detector-name`. Used in findings_summary. */
  why: string;
}

export type ScanStatus = 'pending' | 'clean' | 'flagged' | 'quarantined';

export interface ScanInfo {
  status: ScanStatus;
  findings_summary: FindingsSummary;
}

/**
 * Public, web-facing projection of a single {@link Finding}.
 *
 * Deliberately a SUBSET of `Finding`: it carries category, confidence, file,
 * line range, and the `why` detector id — exactly the fields the public
 * security tab renders. It intentionally OMITS `snippet`: snippets are
 * excerpts of the publisher's flagged source, and serving them on a public
 * endpoint would re-publish secret-adjacent bytes to anonymous callers (the
 * very thing the secret detector flags). The graded-diff path keeps snippets
 * because that view is already gated to the reviewing owner.
 */
export interface PublicFinding {
  category: Category;
  confidence: Severity;
  file: string;
  lineStart: number;
  lineEnd: number;
  why: string;
  /** Flagged excerpt — a short "peek" at the line. Included only when the caller
   *  is allowed it (see the scan endpoint's gating) and NEVER for `secret`
   *  findings (the bytes would be the secret itself). Absent otherwise. */
  snippet?: string;
  /** Author's explanation of why this flagged pattern is intentional.
   *  Public skills only; merged from the version metadata at read time. */
  note?: string;
}

/**
 * Public projection of a single capability observation. A LOCATION ONLY —
 * file + line band + whether it came from executable code or instruction prose.
 *
 * Deliberately carries NO snippet. Unlike a threat {@link Finding} there is no
 * source excerpt on a capability to begin with: the UI only needs the location
 * to drive its drill-down (the `revealFinding(file, line)` file-viewer scroll),
 * so there is nothing secret-adjacent to redact. We still rebuild this object
 * field-by-field at the serve boundary (see `toPublicCapabilities`) so no future
 * field on the internal evidence type can silently ride out to public callers.
 */
export interface PublicCapabilityEvidence {
  file: string;
  lineStart: number;
  lineEnd: number;
  source: 'code' | 'instructions';
}

/** Public projection of one aggregated capability entry (locations only). */
export interface PublicCapabilityEntry {
  capability: Capability;
  /** Threat-finding join: a co-located risky finding makes this capability risky. */
  risky: boolean;
  evidence: PublicCapabilityEvidence[];
}

/** Public read model for the per-version security tab. */
export interface ScanReport {
  status: ScanStatus;
  findings_summary: FindingsSummary;
  /** Full per-finding list, snippet-stripped. Empty for clean/pending. */
  findings: PublicFinding[];
  /**
   * Installer-facing capability inventory ("what can this skill do?"). A FLAT
   * null-vs-empty contract on the wire:
   *   - `null`     → capabilities were NEVER computed for this version (an older
   *     row, or a still-`pending` insert). The UI shows nothing / "not analyzed".
   *   - `[]`       → computed and found nothing. UI shows "No capabilities detected".
   *   - non-empty  → detected capabilities, each with evidence LOCATIONS only.
   * Independent of threat-finding gating: returned for CLEAN skills too, not
   * just flagged/quarantined ones.
   */
  capabilities: PublicCapabilityEntry[] | null;
  /**
   * Trust qualifier on the manifest above (the core safety signal, KTD5):
   *   - `'full'`    → every executable-shaped file was inspected; an empty
   *     `capabilities` is a real "nothing detected".
   *   - `'partial'` → at least one executable file went un-inspected (unhandled
   *     language, oversized, or binary), so an empty `capabilities` means
   *     "nothing found in what we could read", NOT "inert". The UI must say so.
   *   - `null`      → capabilities were never computed (mirrors `capabilities: null`).
   */
  capabilities_analysis: 'full' | 'partial' | null;
  /**
   * The un-inspected file paths behind a `'partial'` analysis (binary-shaped,
   * oversized, or unsupported-language). Lets the installer UI name exactly which
   * files weren't scanned ("Unscanned files") instead of a vague "some files".
   * `[]` when analysis is `'full'`, never computed, or a legacy row predating the
   * field. Paths are bundle-relative, already public on the skill page.
   */
  capabilities_blind_spots: string[];
}

export interface FindingsSummary {
  /** Total findings across all categories. */
  total: number;
  /** Per-category, per-confidence counts. Empty buckets omitted. */
  counts: Partial<Record<Category, Partial<Record<Severity, number>>>>;
  /** Highest confidence reached. `null` when total === 0. */
  topConfidence: Severity | null;
  /**
   * Up to 5 highlight findings for graded-diff display. Snippets are already
   * truncated; this is a stable subset, not the full list.
   */
  highlights: Array<Pick<Finding, 'category' | 'confidence' | 'file' | 'why'>>;
}

/** Result of a synchronous scan over a decoded bundle. */
export interface ScanResult {
  status: Exclude<ScanStatus, 'pending'>;
  findings: Finding[];
  summary: FindingsSummary;
}

/**
 * Runtime contract for a detector: pure function over a single text file.
 * Detectors MUST NOT do IO or modify state.
 */
export type Detector = (filePath: string, contents: string) => Finding[];
