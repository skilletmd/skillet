// U5 — Capability eval harness.
//
// Runs the labeled corpus through the real scan wiring
// (`runCapabilityScan([...CODE, ...PROSE])`) and scores it. Unlike the category
// classifier eval (classify/eval.ts), this is PURE and deterministic — no API
// key, no network — because the detectors are pure.
//
// The decisive metric is INERT ACCURACY: of the fixtures that genuinely use a
// capability, the fraction whose detection contains every expected capability
// (i.e. no MISSED capability). It must be 100%, because a miss makes the
// installer's "No capabilities detected" empty state a lie. Per-capability
// precision/recall is reported too: recall must be 100% (no misses); precision
// may be below 100% (advisory over-reports on near-miss prose are accepted).

import { runCapabilityScan } from './collector.js';
// The one production detector roster — importing it (not a local copy) means a
// new detector family can never be silently absent from the eval gate.
import { ALL_CAPABILITY_DETECTORS } from './scan.js';
import { CAPABILITIES, CAPABILITY_CORPUS, toBundle, type CapabilityCorpusEntry } from './corpus.js';
import type { Capability } from './types.js';

const ALL_DETECTORS = ALL_CAPABILITY_DETECTORS;

export interface CapabilityCaseResult {
  id: string;
  kind: CapabilityCorpusEntry['kind'];
  label: string;
  /** Ground-truth capabilities (must all be detected). */
  expected: Capability[];
  /** What the detectors actually emitted (sorted). */
  detected: Capability[];
  /** Expected but not detected — must always be empty (the hard gate). */
  missed: Capability[];
  /** Detected but not expected — accepted advisory over-reports. */
  over: Capability[];
  /** Whether this fixture is labeled inert (expects an empty manifest). */
  inertExpected: boolean;
  /** For inert fixtures: detection was empty as required. */
  inertOk: boolean;
}

export interface PerCapabilityStats {
  tp: number;
  fp: number;
  fn: number;
  /** tp / (tp + fp); 1 when nothing was detected for the capability. */
  precision: number;
  /** tp / (tp + fn); 1 when nothing expected the capability. */
  recall: number;
}

export interface CapabilityEvalReport {
  total: number;
  /** Fixtures whose ground truth uses >= 1 capability. */
  capabilityUsing: number;
  /** Fixtures labeled inert (expect an empty manifest). */
  inertCases: number;
  /**
   * THE GATE: fraction of capability-using fixtures with zero missed
   * capabilities (detection ⊇ ground truth). Must be 1.0 — zero false "inert".
   */
  inertAccuracy: number;
  /** Fixtures with at least one missed capability (must be empty). */
  missedFixtures: CapabilityCaseResult[];
  /** Inert fixtures that wrongly produced a chip (must be empty). */
  inertViolations: CapabilityCaseResult[];
  perCapability: Record<Capability, PerCapabilityStats>;
  results: CapabilityCaseResult[];
}

function detectCapabilities(entry: CapabilityCorpusEntry): Capability[] {
  const report = runCapabilityScan(toBundle(entry.bundle), ALL_DETECTORS);
  return report.capabilities.map((c) => c.capability).sort();
}

function diff(a: Capability[], b: Set<Capability>): Capability[] {
  return a.filter((x) => !b.has(x));
}

export function runCapabilityEval(
  corpus: CapabilityCorpusEntry[] = CAPABILITY_CORPUS,
): CapabilityEvalReport {
  const results: CapabilityCaseResult[] = [];

  const perCapability = {} as Record<Capability, PerCapabilityStats>;
  for (const c of CAPABILITIES) {
    perCapability[c] = { tp: 0, fp: 0, fn: 0, precision: 1, recall: 1 };
  }

  for (const entry of corpus) {
    const detected = detectCapabilities(entry);
    const expected = [...entry.expectCapabilities].sort();
    const detectedSet = new Set(detected);
    const expectedSet = new Set(expected);

    const missed = diff(expected, detectedSet); // FN
    const over = diff(detected, expectedSet); // FP
    const inertExpected = entry.expectInert === true;
    const inertOk = inertExpected ? detected.length === 0 : true;

    for (const c of CAPABILITIES) {
      const isDet = detectedSet.has(c);
      const isExp = expectedSet.has(c);
      if (isDet && isExp) perCapability[c].tp++;
      else if (isDet && !isExp) perCapability[c].fp++;
      else if (!isDet && isExp) perCapability[c].fn++;
    }

    results.push({
      id: entry.id,
      kind: entry.kind,
      label: entry.label,
      expected,
      detected,
      missed,
      over,
      inertExpected,
      inertOk,
    });
  }

  for (const c of CAPABILITIES) {
    const s = perCapability[c];
    s.precision = s.tp + s.fp === 0 ? 1 : s.tp / (s.tp + s.fp);
    s.recall = s.tp + s.fn === 0 ? 1 : s.tp / (s.tp + s.fn);
  }

  const capUsing = results.filter((r) => r.expected.length > 0);
  const noMiss = capUsing.filter((r) => r.missed.length === 0);
  const inertCases = results.filter((r) => r.inertExpected);

  return {
    total: results.length,
    capabilityUsing: capUsing.length,
    inertCases: inertCases.length,
    inertAccuracy: capUsing.length ? noMiss.length / capUsing.length : 1,
    missedFixtures: results.filter((r) => r.missed.length > 0),
    inertViolations: inertCases.filter((r) => !r.inertOk),
    perCapability,
    results,
  };
}

export function formatCapabilityEvalMarkdown(report: CapabilityEvalReport): string {
  const pct = (n: number) => `${Math.round(100 * n)}%`;
  const lines: string[] = [];

  lines.push('# Capability eval');
  lines.push('');
  lines.push(
    `**Inert accuracy: ${pct(report.inertAccuracy)}** ` +
      `(${report.capabilityUsing - report.missedFixtures.length}/${report.capabilityUsing} ` +
      `capability-using fixtures detected with no missed capability)`,
  );
  lines.push('');
  lines.push(
    `${report.total} fixtures · ${report.capabilityUsing} capability-using · ${report.inertCases} inert`,
  );
  lines.push('');

  lines.push('## Per-capability');
  lines.push('');
  lines.push('| capability | tp | fp | fn | precision | recall |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const c of CAPABILITIES) {
    const s = report.perCapability[c];
    lines.push(`| ${c} | ${s.tp} | ${s.fp} | ${s.fn} | ${pct(s.precision)} | ${pct(s.recall)} |`);
  }
  lines.push('');

  const missed = report.missedFixtures;
  lines.push(`## Missed capabilities (${missed.length}) — must be 0`);
  lines.push('');
  if (missed.length === 0) {
    lines.push('_None. Every capability-using fixture shows its capability._');
  } else {
    lines.push('| fixture | missed |');
    lines.push('| --- | --- |');
    for (const r of missed) lines.push(`| ${r.id} | ${r.missed.join(', ')} |`);
  }
  lines.push('');

  const inertBad = report.inertViolations;
  lines.push(`## Inert violations (${inertBad.length}) — must be 0`);
  lines.push('');
  if (inertBad.length === 0) {
    lines.push('_None. Every inert fixture shows an empty manifest._');
  } else {
    lines.push('| fixture | detected |');
    lines.push('| --- | --- |');
    for (const r of inertBad) lines.push(`| ${r.id} | ${r.detected.join(', ')} |`);
  }
  lines.push('');

  const over = report.results.filter((r) => r.over.length > 0);
  lines.push(`## Over-reports (${over.length}) — advisory, accepted`);
  lines.push('');
  if (over.length === 0) {
    lines.push('_None._');
  } else {
    lines.push('| fixture | over-reported |');
    lines.push('| --- | --- |');
    for (const r of over) lines.push(`| ${r.id} | ${r.over.join(', ')} |`);
  }
  lines.push('');

  return lines.join('\n');
}
