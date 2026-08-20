import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ASYNC_DETECTORS } from '../src/scanner/scanner.js';
import { secretsDetector } from '../src/scanner/detectors/threat/secrets.js';

describe('async scan fleet', () => {
  it('includes secretsDetector for retroactive quarantine', () => {
    assert.ok(ASYNC_DETECTORS.includes(secretsDetector));
  });
});
