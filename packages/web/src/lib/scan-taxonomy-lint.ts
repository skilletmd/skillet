// Deterministic consistency lints for the scanner's user-facing vocabulary.
//
// There is now ONE vocabulary — `SCAN_VOCABULARY` in `@skillet/protocol`
// (permissions + flags, keyed by the ids detectors emit). The ids those entries
// describe live in the registry, distilled into the committed
// `scan-detector-inventory.json` manifest. `lintTaxonomy` joins the two and
// returns structured findings — each an issue + a concrete suggested fix — so a
// contributor extending the scanner keeps tone, length, and copy↔detector
// coverage consistent. Pure: no I/O, no rendering; the `/lab/scanner` page just
// maps findings onto rows.

import type { ScanVocabularyEntry } from '@skillet/protocol'

/** The committed registry detector inventory (shape of scan-detector-inventory.json). */
export interface DetectorManifest {
  threatCategories: Record<string, { detectors: string[]; whyTags: string[] }>
  capabilities: string[]
  partialDetectors: string[]
}

/** The one scanner vocabulary the lint reads, keyed by emitted id. Passed in (not
 *  imported) so the rules are pure and unit-testable against fixtures. In
 *  production this is the protocol `SCAN_VOCABULARY`. */
export type Vocabulary = Record<string, ScanVocabularyEntry>

export type LintSeverity = 'info' | 'warn' | 'error'

export interface LintFinding {
  /** What the finding is about, namespaced so the page renders it unambiguously:
   *  `flag:<id>` (a threat-category entry) or `permission:<id>` (a capability
   *  entry). */
  target: string
  severity: LintSeverity
  /** One line: what's inconsistent. */
  issue: string
  /** One line: the concrete next step. */
  suggestion: string
}

// Copy-length bounds (chars). Picked lenient against the real corpus (describes
// run ~28–110 chars) so only genuine outliers flag and a clean entry stays quiet.
const DESCRIBE_MIN = 20
const DESCRIBE_MAX = 200
const FIX_MIN = 15
const FIX_MAX = 200

/** A `why` shaped like a raw machine tag — no whitespace and a `family:detail`
 *  shape — rather than human prose. Mirrors the trust-panel prose heuristic. */
export function isMachineTag(why: string): boolean {
  return !/\s/.test(why) && /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(why)
}

/** Namespaced target for an entry, by lane. */
function targetFor(entry: ScanVocabularyEntry): string {
  return `${entry.kind === 'permission' ? 'permission' : 'flag'}:${entry.id}`
}

function median(ns: number[]): number {
  if (ns.length === 0) return 0
  const sorted = [...ns].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Lint the one vocabulary against the detector manifest. Deterministic: findings
 * are emitted in a stable order (coverage gaps, then copy quality, then partial
 * notes) and sorted within each group by target.
 */
export function lintTaxonomy(vocabulary: Vocabulary, manifest: DetectorManifest): LintFinding[] {
  const findings: LintFinding[] = []
  const entries = Object.entries(vocabulary).sort(([a], [b]) => a.localeCompare(b))

  // Every id a detector actually emits: every threat category + every capability.
  const emittedFlagIds = new Set(Object.keys(manifest.threatCategories))
  const emittedCapIds = new Set(manifest.capabilities)

  // --- 1. Coverage: emitted id with no vocabulary entry --------------------
  // A detector emits this id but no copy describes it, so its findings would
  // render with no label/describe at all. An error: the wire is ahead of the copy.
  for (const id of [...emittedFlagIds].sort()) {
    if (!vocabulary[id]) {
      findings.push({
        target: `flag:${id}`,
        severity: 'error',
        issue: 'Detector emits this threat category but no vocabulary entry describes it.',
        suggestion: `Add a FLAGS entry for "${id}" to scan-vocabulary.ts so installers see real copy.`,
      })
    }
  }
  for (const id of [...emittedCapIds].sort()) {
    if (!vocabulary[id]) {
      findings.push({
        target: `permission:${id}`,
        severity: 'error',
        issue: 'Detector emits this capability but no vocabulary entry describes it.',
        suggestion: `Add a PERMISSIONS entry for "${id}" to scan-vocabulary.ts so installers see real copy.`,
      })
    }
  }

  // --- 2. Coverage: vocabulary entry no detector emits ---------------------
  // A dangling flag — copy with no detector behind it, so it can never appear
  // on a real scan. An error: every vocabulary entry must be wired to a detector
  // in the committed inventory, or it's dead copy that should be removed.
  for (const [id, entry] of entries) {
    const emitted = entry.kind === 'permission' ? emittedCapIds.has(id) : emittedFlagIds.has(id)
    if (!emitted) {
      findings.push({
        target: targetFor(entry),
        severity: 'error',
        issue: 'Vocabulary entry that no detector emits per the inventory.',
        suggestion: `Wire a detector that emits "${id}", or remove the dangling vocabulary entry.`,
      })
    }
  }

  // --- 3. Copy quality: missing/blank fields, length, tone -----------------
  const describeLens = entries.map(([, e]) => e.describe.trim().length).filter((n) => n > 0)
  const describeMedian = median(describeLens)
  for (const [, entry] of entries) {
    const t = targetFor(entry)
    const describe = entry.describe.trim()
    const label = entry.label.trim()
    if (!label) {
      findings.push({ target: t, severity: 'error', issue: 'Missing label.', suggestion: `Add a short plain-English name for "${entry.id}".` })
    }
    if (!describe) {
      findings.push({ target: t, severity: 'error', issue: 'Missing describe (installer-facing copy).', suggestion: 'Write one plain-English sentence: what the pattern is.' })
    } else {
      if (describe.length < DESCRIBE_MIN) findings.push({ target: t, severity: 'warn', issue: `Describe is very short (${describe.length} chars).`, suggestion: 'Expand to a full sentence an installer can act on.' })
      if (describe.length > DESCRIBE_MAX) findings.push({ target: t, severity: 'warn', issue: `Describe is very long (${describe.length} chars).`, suggestion: 'Tighten to one or two sentences.' })
      if (describeMedian > 0 && describe.length > describeMedian * 2.5) findings.push({ target: t, severity: 'info', issue: `Describe is ${Math.round(describe.length / describeMedian)}× the median length.`, suggestion: 'Match the brevity of the other entries.' })
      if (!/[.!?]$/.test(describe)) findings.push({ target: t, severity: 'info', issue: 'Describe does not end with sentence punctuation.', suggestion: 'End the sentence with a period for tone consistency.' })
    }
    // Only flags carry author-facing `fix`; permissions are installer-voice only.
    if (entry.kind === 'flag') {
      const fix = (entry.fix ?? '').trim()
      if (!fix) {
        findings.push({ target: t, severity: 'error', issue: 'Missing fix (author-facing guidance).', suggestion: 'Write one line: how to fix it or what to confirm.' })
      } else {
        if (fix.length < FIX_MIN) findings.push({ target: t, severity: 'warn', issue: `Fix is very short (${fix.length} chars).`, suggestion: 'Give the author a concrete action.' })
        if (fix.length > FIX_MAX) findings.push({ target: t, severity: 'warn', issue: `Fix is very long (${fix.length} chars).`, suggestion: 'Tighten to the essential action.' })
      }
    }
  }

  // --- 4. Inventory honesty: partial detectors -----------------------------
  for (const id of [...manifest.partialDetectors].sort()) {
    const entry = vocabulary[id]
    const target = entry ? targetFor(entry) : `flag:${id}`
    findings.push({ target, severity: 'info', issue: 'Detector builds its why tags dynamically. The inventory can’t enumerate them.', suggestion: 'Copy for this id can’t be verified per-why; review its findings manually.' })
  }

  return findings
}
