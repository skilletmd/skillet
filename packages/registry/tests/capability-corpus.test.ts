// U5 — Capability corpus gate.
//
// Runs the labeled benign / near-miss corpus through the real scan wiring
// (`runCapabilityScan([...CODE, ...PROSE])`) and enforces the contract behind
// the installer's empty state:
//
//  - HARD GATE: every fixture that genuinely uses a capability shows it
//    (inert accuracy = 100%; zero false "inert"). A miss here would make
//    "No capabilities detected" a lie.
//  - Inert fixtures (pure prose, no scripts) show NO capabilities.
//  - Near-miss prose over-reports only in the safe direction and stays scoped
//    (the specific expected set is asserted; over-report is documented).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCapabilityScan } from '../src/scanner/capabilities/collector.js';
// Import the production roster so this gate scans with the same detector set the
// registry runs — a new detector family can't be silently missing from coverage.
import { ALL_CAPABILITY_DETECTORS } from '../src/scanner/capabilities/scan.js';
import {
  CAPABILITIES,
  CAPABILITY_CORPUS,
  toBundle,
} from '../src/scanner/capabilities/corpus.js';
import { runCapabilityEval } from '../src/scanner/capabilities/eval.js';
import type { Capability } from '../src/scanner/capabilities/types.js';

const ALL_DETECTORS = ALL_CAPABILITY_DETECTORS;

function detect(files: Record<string, string>): Capability[] {
  return runCapabilityScan(toBundle(files), ALL_DETECTORS)
    .capabilities.map((c) => c.capability)
    .sort();
}

function analysisOf(files: Record<string, string>): 'full' | 'partial' {
  return runCapabilityScan(toBundle(files), ALL_DETECTORS).analysis;
}

describe('capability corpus — per-fixture expectations', () => {
  for (const entry of CAPABILITY_CORPUS) {
    it(`${entry.id}: ${entry.label}`, () => {
      const detected = detect(entry.bundle);
      const detectedSet = new Set(detected);

      // HARD GATE: every ground-truth capability must be detected. A miss makes
      // the installer's empty state untrustworthy.
      for (const cap of entry.expectCapabilities) {
        assert.ok(
          detectedSet.has(cap),
          `${entry.id}: expected capability "${cap}" was MISSED (detected: [${detected.join(', ')}])`,
        );
      }

      // Inert fixtures must show nothing.
      if (entry.expectInert) {
        assert.deepEqual(
          detected,
          [],
          `${entry.id}: inert fixture must show NO capabilities, got [${detected.join(', ')}]`,
        );
      }

      // Pin the exact detector output where declared (documents accepted
      // over-reports and proves near-miss prose does not over-report broadly).
      if (entry.expectExact) {
        assert.deepEqual(
          detected,
          [...entry.expectExact].sort(),
          `${entry.id}: detected set drifted from the pinned expectation`,
        );
      }

      // FIX3: the analysis qualifier on the manifest, where pinned. 'partial'
      // means executable content went un-inspected, so an empty manifest is NOT
      // a claim of inertness.
      if (entry.expectAnalysis) {
        assert.equal(
          analysisOf(entry.bundle),
          entry.expectAnalysis,
          `${entry.id}: analysis flag drifted from the pinned expectation`,
        );
      }
    });
  }
});

describe('capability corpus — partial analysis', () => {
  it('an unhandled-language executable shows an EMPTY manifest but analysis=partial', () => {
    const entry = CAPABILITY_CORPUS.find((e) => e.id === 'unhandled-ruby-system-net');
    assert.ok(entry, 'unhandled-ruby-system-net fixture present');
    assert.deepEqual(detect(entry!.bundle), [], 'no Ruby detector → empty manifest');
    assert.equal(analysisOf(entry!.bundle), 'partial', 'but flagged partial, never inert');
  });

  it('a binary script-shaped file marks the report partial', () => {
    const entry = CAPABILITY_CORPUS.find((e) => e.id === 'unhandled-binary-script-shaped');
    assert.ok(entry, 'unhandled-binary-script-shaped fixture present');
    assert.equal(analysisOf(entry!.bundle), 'partial');
  });

  it('a benign covered-language fixture stays full', () => {
    const entry = CAPABILITY_CORPUS.find((e) => e.id === 'benign-network-fetch-js');
    assert.ok(entry);
    assert.equal(analysisOf(entry!.bundle), 'full');
  });
});

describe('capability corpus — prose precision', () => {
  it('a doc URL with no transfer verb does NOT flag network', () => {
    const entry = CAPABILITY_CORPUS.find((e) => e.id === 'inert-doc-url-only');
    assert.ok(entry, 'inert-doc-url-only fixture present');
    assert.deepEqual(detect(entry!.bundle), [], 'bare reference URL is not network');
  });

  it('a ```js example with fetch()/eval() is not mis-read as commands', () => {
    const entry = CAPABILITY_CORPUS.find((e) => e.id === 'inert-fenced-js-example');
    assert.ok(entry, 'inert-fenced-js-example fixture present');
    assert.deepEqual(detect(entry!.bundle), [], 'non-shell fence is documentation');
  });
});

describe('capability corpus — coverage', () => {
  it('exercises all nine capabilities in benign/instruction ground truth', () => {
    const covered = new Set<Capability>();
    for (const entry of CAPABILITY_CORPUS) {
      if (entry.kind === 'benign-code' || entry.kind === 'instruction-only') {
        for (const cap of entry.expectCapabilities) covered.add(cap);
      }
    }
    for (const cap of CAPABILITIES) {
      assert.ok(covered.has(cap), `no benign/instruction fixture covers capability "${cap}"`);
    }
  });

  it('includes benign-code, instruction-only, inert, and near-miss fixtures', () => {
    const kinds = new Set(CAPABILITY_CORPUS.map((e) => e.kind));
    for (const kind of ['benign-code', 'instruction-only', 'inert', 'near-miss'] as const) {
      assert.ok(kinds.has(kind), `corpus is missing a "${kind}" fixture`);
    }
  });
});

describe('capability eval — hard gate', () => {
  const report = runCapabilityEval();

  it('INERT ACCURACY is 100% — every capability-using fixture shows its capability', () => {
    assert.equal(
      report.inertAccuracy,
      1,
      `inert accuracy ${Math.round(report.inertAccuracy * 100)}% — missed fixtures: ${report.missedFixtures
        .map((r) => `${r.id} [${r.missed.join(', ')}]`)
        .join('; ')}`,
    );
  });

  it('no fixture misses a ground-truth capability', () => {
    assert.deepEqual(
      report.missedFixtures.map((r) => r.id),
      [],
    );
  });

  it('no inert fixture produces a chip', () => {
    assert.deepEqual(
      report.inertViolations.map((r) => r.id),
      [],
    );
  });

  it('per-capability recall is 100% for every capability', () => {
    for (const cap of CAPABILITIES) {
      assert.equal(report.perCapability[cap].recall, 1, `recall < 100% for "${cap}"`);
    }
  });
});

describe('capability corpus — near-miss does not over-report broadly', () => {
  it('a negated "rm -rf" warning flags only delete+shell, not network/writes/secrets', () => {
    const entry = CAPABILITY_CORPUS.find((e) => e.id === 'near-miss-negated-rm');
    assert.ok(entry, 'near-miss-negated-rm fixture present');
    const detected = new Set(detect(entry!.bundle));
    assert.ok(detected.has('deletes-files'));
    assert.ok(detected.has('runs-shell'));
    // Safe-direction over-report only; it must NOT invent unrelated capabilities.
    assert.ok(!detected.has('network'));
    assert.ok(!detected.has('writes-files'));
    assert.ok(!detected.has('reads-secrets'));
  });

  it('a glossary that only DEFINES "API key" (no read action) is inert (v3)', () => {
    const entry = CAPABILITY_CORPUS.find((e) => e.id === 'near-miss-glossary-apikey');
    assert.ok(entry, 'near-miss-glossary-apikey fixture present');
    // v3 requires a read/consume verb beside the secret noun, so a bare
    // definitional mention flags nothing.
    assert.deepEqual(detect(entry!.bundle), []);
  });
});
