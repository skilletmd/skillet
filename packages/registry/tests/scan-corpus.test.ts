import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildCorpusReport,
  buildCorpusReportFromRepo,
  formatCorpusReportMarkdown,
  loadBenignFromRepo,
  type BenignCorpusEntry,
} from '../src/scanner/corpus-report.js';
import { MALICIOUS_CORPUS } from '../src/scanner/malicious-corpus.js';
import { BENIGN_NEAR_MISS_CORPUS } from '../src/scanner/benign-corpus.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

/** N clean synthetic published-version bundles, standing in for a prod snapshot. */
function cleanProdCorpus(n: number): BenignCorpusEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `pub-${i}`,
    bundle: new Map([['SKILL.md', Buffer.from(`---\nname: pub-${i}\n---\nA helpful skill.\n`)]]),
  }));
}

describe('scan corpus report', () => {
  it('loads in-repo skills as benign bundles', async () => {
    const benign = await loadBenignFromRepo(repoRoot);
    assert.ok(benign.length >= 4, 'expected at least four in-repo skills');
    assert.ok(benign.every((b) => b.bundle.has('SKILL.md')));
  });

  it('reports zero false positives on the in-repo benign catalog', async () => {
    const benign = await loadBenignFromRepo(repoRoot);
    const report = buildCorpusReport(benign);
    assert.equal(report.falsePositiveRate, 0);
    assert.equal(report.quarantineFalsePositiveRate, 0);
    assert.ok(report.benign.every((b) => b.findingCount === 0));
  });

  it('reports full recall on the labeled malicious fixture set', () => {
    const report = buildCorpusReport([], MALICIOUS_CORPUS);
    assert.ok(report.recallRate >= 0.8, `recall ${report.recallRate}`);
    const failures = report.malicious.filter((m) => !m.recallOk);
    assert.equal(failures.length, 0, failures.map((f) => f.id).join(', '));
  });

  it('holds every near-miss negative below the blocking tier', () => {
    const report = buildCorpusReport([]);
    assert.equal(report.nearMiss.length, BENIGN_NEAR_MISS_CORPUS.length);
    assert.equal(report.nearMissBlockedCount, 0);
    assert.ok(
      report.nearMiss.every((n) => n.discriminationOk && n.status !== 'quarantined'),
      'a near-miss benign reached the blocking tier — discrimination failure',
    );
  });

  it('reports in-repo conditional-go once catalog is large enough without prod snapshot', async () => {
    const benign = await loadBenignFromRepo(repoRoot);
    const report = await buildCorpusReportFromRepo(repoRoot);
    if (benign.length >= 10) {
      assert.equal(report.recommendation, 'conditional-go');
    } else {
      assert.equal(report.recommendation, 'inconclusive');
    }
    assert.ok(
      report.notes.some(
        (n) => n.includes('Production snapshot') || n.includes('production snapshot'),
      ),
    );
  });

  it('recommends GO when a clean prod corpus clears the quarantine gate with full recall', () => {
    const report = buildCorpusReport(cleanProdCorpus(12), MALICIOUS_CORPUS, undefined, {
      inRepoBenignCount: 0,
      prodSnapshotCount: 12,
    });
    assert.equal(report.quarantineFalsePositiveRate, 0);
    assert.equal(report.recallRate, 1);
    assert.equal(report.recommendation, 'go');
  });

  it('blocks (NO-GO) when a benign bundle is falsely quarantined', () => {
    const corpus = [
      ...cleanProdCorpus(11),
      { id: 'bad', bundle: new Map([['setup.sh', Buffer.from('#!/bin/sh\nrm -rf /\n')]]) },
    ];
    const report = buildCorpusReport(corpus);
    assert.ok(report.quarantineFalsePositiveRate > 0.01);
    assert.equal(report.recommendation, 'no-go');
  });

  it('renders a markdown report with the tier-aware summary tables', async () => {
    const report = await buildCorpusReportFromRepo(repoRoot);
    const md = formatCorpusReportMarkdown(report);
    assert.match(md, /Quarantine-tier FP \(HARD GATE/);
    assert.match(md, /Near-miss negatives/);
    assert.match(md, /Malicious fixtures/);
    assert.match(md, /inconclusive|conditional-go|go|no-go/);
  });
});
