import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { obfuscationDetector } from '../src/scanner/detectors/threat/obfuscation.js';
import { outputHandlingDetector } from '../src/scanner/detectors/threat/output-handling.js';
import { scanBundle, MAX_DETECT_BYTES } from '../src/scanner/scan-engine.js';
import { secretsBlockingScan } from '../src/scanner/scanner.js';
import type { DecodedBundle } from '@skillet/protocol';

const enc = new TextEncoder();

function bundle(files: Record<string, string>): DecodedBundle {
  return new Map(Object.entries(files).map(([p, v]) => [p, enc.encode(v)]));
}

describe('scanner ReDoS guards', () => {
  it('homoglyph detector completes quickly on a megabyte ASCII line', () => {
    const line = 'a'.repeat(1_000_000) + 'а';
    const start = performance.now();
    obfuscationDetector('notes.txt', line);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 2000, `homoglyph scan took ${elapsed}ms`);
  });

  it('model-output-to-sql detector completes quickly on long percent runs', () => {
    const line = 'execute(' + '%'.repeat(500_000) + 'model_output)';
    const start = performance.now();
    outputHandlingDetector('notes.txt', line);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 2000, `output-handling scan took ${elapsed}ms`);
  });

  it('threat scan uses a bounded prefix on oversized text files', () => {
    const big = 'x'.repeat(MAX_DETECT_BYTES + 50_000);
    let seenLen = 0;
    scanBundle(bundle({ 'big.txt': big }), {
      threatDetectors: [(_file, contents) => {
        seenLen = contents.length;
        return [];
      }],
    });
    assert.equal(seenLen, MAX_DETECT_BYTES);
  });

  it('secretsBlockingScan detects a secret in a normal bundle (no regression)', () => {
    // AKIA + 16 base32-ish chars: a real-shape high-confidence secret.
    const hit = secretsBlockingScan(bundle({ 'setup.sh': 'AWS_ACCESS_KEY_ID=AKIA2RZ7K4Q3PN5T6XW9\n' }));
    assert.ok(hit, 'high-confidence secret is flagged');
  });

  it('secretsBlockingScan is bounded and completes quickly on an oversized file', () => {
    // Secret is past the prefix cap, so it is not scanned — bounding is the point.
    const big = 'x'.repeat(MAX_DETECT_BYTES + 50_000) + '\nAWS_ACCESS_KEY_ID=AKIA2RZ7K4Q3PN5T6XW9\n';
    const start = performance.now();
    const hit = secretsBlockingScan(bundle({ 'big.sh': big }));
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 2000, `secrets scan took ${elapsed}ms`);
    assert.equal(hit, null, 'a secret beyond MAX_DETECT_BYTES is outside the scanned prefix');
  });
});
