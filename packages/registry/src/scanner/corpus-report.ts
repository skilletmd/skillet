// Harm-scan corpus report for the go/no-go gate (Phase 1).
//
// Runs `runScan` over a benign set (in-repo skills and/or a production dump)
// plus the labeled malicious corpus and the labeled near-miss negatives, then
// emits a TIER-AWARE false-positive rate, recall, and a recommendation string.
//
// Tiering matters for the go/no-go decision. The scanner has exactly one
// blocking tier — `quarantined` (a high-confidence finding) plus the
// synchronous publish-time secret gate. `flagged` is a non-blocking advisory
// badge. Per the ratified decision rule (see methodology comment):
//   - quarantine-tier FP is the HARD gate (must be ≤1% on prod; 0 on labeled
//     near-misses) — a false quarantine blocks a legitimate publisher.
//   - flag-tier FP is advisory and tolerates higher noise — a noisy badge is
//     acceptable ("host whatever you want").
// So we report the two rates separately and gate on the quarantine tier only.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DecodedBundle } from '@skillet/protocol';
import { runScan, secretsBlockingScan } from './scanner.js';
import { MALICIOUS_CORPUS, type MaliciousCorpusEntry } from './malicious-corpus.js';
import {
  BENIGN_NEAR_MISS_CORPUS,
  type BenignNearMissEntry,
} from './benign-corpus.js';
import type { Category, ScanResult } from './types.js';

/** Prod benign sample below this size cannot give a meaningful prod FP rate. */
const MIN_PROD_BENIGN = 10;
/** Hard gate: quarantine-tier FP must stay at or below this on the prod corpus. */
const QUARANTINE_FP_CEILING = 0.01;
/** Advisory-tier noise above this nudges a GO down to conditional. */
const FLAG_FP_SOFT_CEILING = 0.1;

export interface BenignCorpusEntry {
  id: string;
  bundle: DecodedBundle;
}

export interface BenignScanRow {
  id: string;
  status: ScanResult['status'];
  /** True when the bundle reaches the blocking tier (quarantine or secret gate). */
  blocked: boolean;
  findingCount: number;
  categories: Category[];
}

export interface NearMissScanRow {
  id: string;
  label: string;
  expectMaxStatus: Exclude<ScanResult['status'], 'quarantined'>;
  status: ScanResult['status'];
  blocked: boolean;
  findingCount: number;
  categories: Category[];
  /** True when the near-miss stayed below the blocking tier (the guarantee). */
  discriminationOk: boolean;
}

export interface MaliciousScanRow {
  id: string;
  label: string;
  status: ScanResult['status'];
  findingCount: number;
  categories: Category[];
  recallOk: boolean;
  expectCategories: Category[];
  expectStatus: ScanResult['status'];
}

export type GateRecommendation = 'go' | 'conditional-go' | 'no-go' | 'inconclusive';

export interface CorpusReport {
  generatedAt: string;
  benign: BenignScanRow[];
  nearMiss: NearMissScanRow[];
  malicious: MaliciousScanRow[];
  /** In-repo `skills/` catalog size included in benign rows. */
  inRepoBenignCount: number;
  /** Public published versions from a prod snapshot JSON, if loaded. */
  prodSnapshotCount: number;
  /** Share of benign bundles with any finding (0–1). Overall, not tier-split. */
  falsePositiveRate: number;
  /** HARD GATE: share of benign bundles reaching the blocking tier (0–1). */
  quarantineFalsePositiveRate: number;
  /** Advisory: share of benign bundles flagged but not blocked (0–1). */
  flagFalsePositiveRate: number;
  /** Count of near-miss negatives that wrongly reached the blocking tier. */
  nearMissBlockedCount: number;
  /** Share of malicious entries meeting category + status expectations (0–1). */
  recallRate: number;
  recommendation: GateRecommendation;
  notes: string[];
}

function categoriesFromFindings(result: ScanResult): Category[] {
  return [...new Set(result.findings.map((f) => f.category))];
}

/** A bundle reaches the blocking tier if the async scan quarantines it OR the
 *  synchronous publish-time secret gate would reject it. */
function isBlocked(bundle: DecodedBundle, result: ScanResult): boolean {
  return result.status === 'quarantined' || secretsBlockingScan(bundle) !== null;
}

function scanBenignEntry(entry: BenignCorpusEntry): BenignScanRow {
  const result = runScan(entry.bundle);
  return {
    id: entry.id,
    status: result.status,
    blocked: isBlocked(entry.bundle, result),
    findingCount: result.findings.length,
    categories: categoriesFromFindings(result),
  };
}

function scanNearMissEntry(entry: BenignNearMissEntry): NearMissScanRow {
  const result = runScan(entry.bundle);
  const blocked = isBlocked(entry.bundle, result);
  return {
    id: entry.id,
    label: entry.label,
    expectMaxStatus: entry.expectMaxStatus,
    status: result.status,
    blocked,
    findingCount: result.findings.length,
    categories: categoriesFromFindings(result),
    discriminationOk: !blocked,
  };
}

function maliciousRecallOk(
  entry: MaliciousCorpusEntry,
  result: ScanResult,
  secretBlocked: boolean,
): boolean {
  if (entry.expectCategories.includes('secret')) {
    if (!secretBlocked && result.findings.length === 0) return false;
  } else if (result.findings.length === 0) {
    return false;
  }
  for (const cat of entry.expectCategories) {
    if (cat === 'secret') {
      if (!secretBlocked) return false;
      continue;
    }
    if (!result.findings.some((f) => f.category === cat)) return false;
  }
  if (entry.expectStatus === 'quarantined') {
    return result.status === 'quarantined' || secretBlocked;
  }
  return result.status === entry.expectStatus || result.status === 'quarantined';
}

function scanMaliciousEntry(entry: MaliciousCorpusEntry): MaliciousScanRow {
  const result = runScan(entry.bundle);
  const secretBlocked = secretsBlockingScan(entry.bundle) !== null;
  const recallOk = maliciousRecallOk(entry, result, secretBlocked);
  return {
    id: entry.id,
    label: entry.label,
    status: secretBlocked ? 'quarantined' : result.status,
    findingCount: result.findings.length,
    categories: categoriesFromFindings(result),
    recallOk,
    expectCategories: entry.expectCategories,
    expectStatus: entry.expectStatus,
  };
}

/** Load every `skills/<slug>/SKILL.md` under the repo root as a benign bundle. */
export async function loadBenignFromRepo(repoRoot: string): Promise<BenignCorpusEntry[]> {
  const skillsDir = join(repoRoot, 'skills');
  let names: string[];
  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }

  const out: BenignCorpusEntry[] = [];
  for (const slug of names.sort()) {
    try {
      const md = await readFile(join(skillsDir, slug, 'SKILL.md'), 'utf8');
      out.push({
        id: slug,
        bundle: new Map([['SKILL.md', Buffer.from(md)]]),
      });
    } catch {
      /* skip unreadable skill dirs */
    }
  }
  return out;
}

/**
 * Build the gate report. Pass extra benign entries when a production snapshot
 * JSON dump is available; defaults to scanning the in-repo `skills/` tree only.
 * The labeled near-miss negatives always run — they measure quarantine-tier
 * discrimination directly, independent of the production snapshot.
 */
export function buildCorpusReport(
  benign: BenignCorpusEntry[],
  malicious: MaliciousCorpusEntry[] = MALICIOUS_CORPUS,
  nearMiss: BenignNearMissEntry[] = BENIGN_NEAR_MISS_CORPUS,
  opts: { inRepoBenignCount?: number; prodSnapshotCount?: number } = {},
): CorpusReport {
  const inRepoBenignCount = opts.inRepoBenignCount ?? benign.length;
  const prodSnapshotCount = opts.prodSnapshotCount ?? 0;
  const benignRows = benign.map(scanBenignEntry);
  const nearMissRows = nearMiss.map(scanNearMissEntry);
  const maliciousRows = malicious.map(scanMaliciousEntry);

  const benignWithFindings = benignRows.filter((r) => r.findingCount > 0).length;
  const benignBlocked = benignRows.filter((r) => r.blocked).length;
  const benignFlaggedOnly = benignRows.filter((r) => !r.blocked && r.status === 'flagged').length;
  const denom = benign.length === 0 ? 1 : benign.length;
  const falsePositiveRate = benign.length === 0 ? 0 : benignWithFindings / denom;
  const quarantineFalsePositiveRate = benign.length === 0 ? 0 : benignBlocked / denom;
  const flagFalsePositiveRate = benign.length === 0 ? 0 : benignFlaggedOnly / denom;

  const recallHits = maliciousRows.filter((r) => r.recallOk).length;
  const recallRate = malicious.length === 0 ? 1 : recallHits / malicious.length;

  const nearMissBlockedCount = nearMissRows.filter((r) => r.blocked).length;
  const prodMeasured = prodSnapshotCount >= MIN_PROD_BENIGN;
  const inRepoMeasured = inRepoBenignCount >= MIN_PROD_BENIGN;

  const notes: string[] = [];
  if (benign.length === 0) {
    notes.push('No benign corpus entries — prod FP rate is not measurable.');
  } else if (prodMeasured) {
    notes.push(
      `Prod snapshot included (${prodSnapshotCount} public published version(s)). Quarantine-tier FP measured on live registry bytes.`,
    );
    if (inRepoBenignCount > 0) {
      notes.push(`Also scanned ${inRepoBenignCount} in-repo catalog skill(s) from skills/.`);
    }
  } else if (inRepoMeasured) {
    notes.push(
      'In-repo catalog only (≥10 skills). Production snapshot still required for full gate sign-off.',
    );
  } else {
    notes.push(
      'Benign sample is small (in-repo catalog only). Production snapshot required for gate sign-off.',
    );
  }
  if (nearMissBlockedCount > 0) {
    notes.push(
      `${nearMissBlockedCount} near-miss negative(s) reached the blocking tier — quarantine-tier discrimination failure; treat as NO-GO until detectors are tuned.`,
    );
  }

  // Ratified decision rule. Hard fails (quarantine-tier FP, near-miss block,
  // recall floor) win even before the prod sample is large enough to measure.
  let recommendation: GateRecommendation;
  if (
    nearMissBlockedCount > 0 ||
    quarantineFalsePositiveRate > QUARANTINE_FP_CEILING ||
    recallRate < 0.6
  ) {
    recommendation = 'no-go';
  } else if (!prodMeasured) {
    recommendation = inRepoMeasured ? 'conditional-go' : 'inconclusive';
  } else if (recallRate < 0.8 || flagFalsePositiveRate > FLAG_FP_SOFT_CEILING) {
    recommendation = 'conditional-go';
  } else {
    recommendation = 'go';
  }

  return {
    generatedAt: new Date().toISOString(),
    benign: benignRows,
    nearMiss: nearMissRows,
    malicious: maliciousRows,
    inRepoBenignCount,
    prodSnapshotCount,
    falsePositiveRate,
    quarantineFalsePositiveRate,
    flagFalsePositiveRate,
    nearMissBlockedCount,
    recallRate,
    recommendation,
    notes,
  };
}

export async function buildCorpusReportFromRepo(
  repoRoot: string,
  extraBenign: BenignCorpusEntry[] = [],
): Promise<CorpusReport> {
  const repoBenign = await loadBenignFromRepo(repoRoot);
  return buildCorpusReport([...repoBenign, ...extraBenign], MALICIOUS_CORPUS, BENIGN_NEAR_MISS_CORPUS, {
    inRepoBenignCount: repoBenign.length,
    prodSnapshotCount: extraBenign.length,
  });
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

export function formatCorpusReportMarkdown(report: CorpusReport): string {
  const benignBlocked = report.benign.filter((b) => b.blocked).length;
  const benignFindings = report.benign.filter((b) => b.findingCount > 0).length;
  const lines: string[] = [
    '# Harm-scan corpus report',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    '## Summary',
    '',
    `| Metric | Value |`,
    `| --- | --- |`,
    `| Quarantine-tier FP (HARD GATE, ≤${pct(QUARANTINE_FP_CEILING)}) | ${pct(report.quarantineFalsePositiveRate)} (${benignBlocked}/${report.benign.length} blocked) |`,
    `| Flag-tier FP (advisory) | ${pct(report.flagFalsePositiveRate)} |`,
    `| Any-finding FP (overall) | ${pct(report.falsePositiveRate)} (${benignFindings}/${report.benign.length} with findings) |`,
    `| Near-miss discrimination | ${report.nearMiss.length - report.nearMissBlockedCount}/${report.nearMiss.length} held below block tier |`,
    `| Recall (malicious fixtures) | ${pct(report.recallRate)} (${report.malicious.filter((m) => m.recallOk).length}/${report.malicious.length} passed) |`,
    `| In-repo benign | ${report.inRepoBenignCount} |`,
    `| Prod snapshot benign | ${report.prodSnapshotCount} |`,
    `| Recommendation | **${report.recommendation}** |`,
    '',
  ];

  if (report.notes.length > 0) {
    lines.push('## Notes', '');
    for (const n of report.notes) lines.push(`- ${n}`);
    lines.push('');
  }

  lines.push('## Benign corpus', '');
  if (report.benign.length === 0) {
    lines.push('_No benign entries._', '');
  } else {
    lines.push('| Skill | Status | Blocked | Findings | Categories |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const b of report.benign) {
      lines.push(
        `| ${b.id} | ${b.status} | ${b.blocked ? '**yes**' : 'no'} | ${b.findingCount} | ${b.categories.join(', ') || '—'} |`,
      );
    }
    lines.push('');
  }

  lines.push('## Near-miss negatives (FP discrimination)', '');
  lines.push('| Id | Max allowed | Status | Held | Categories |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const n of report.nearMiss) {
    lines.push(
      `| ${n.id} | ${n.expectMaxStatus} | ${n.status} | ${n.discriminationOk ? 'yes' : '**no**'} | ${n.categories.join(', ') || '—'} |`,
    );
  }
  lines.push('');

  lines.push('## Malicious fixtures (recall)', '');
  lines.push('| Id | Expected | Status | Recall OK |');
  lines.push('| --- | --- | --- | --- |');
  for (const m of report.malicious) {
    lines.push(
      `| ${m.id} | ${m.expectCategories.join('+')} → ${m.expectStatus} | ${m.status} | ${m.recallOk ? 'yes' : '**no**'} |`,
    );
  }
  lines.push('');

  return lines.join('\n');
}
