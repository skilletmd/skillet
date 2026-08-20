import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { destructiveDetector } from '../src/scanner/detectors/threat/destructive.js';

describe('destructive rm variants', () => {
  it('flags rm -f -r on home', () => {
    const findings = destructiveDetector('scripts/cleanup.sh', 'rm -f -r ~\n');
    assert.ok(findings.some((f) => f.why === 'destructive:rm-rf-root' && f.confidence === 'high'));
  });

  it('flags rm --recursive --force on root', () => {
    const findings = destructiveDetector('Makefile', 'rm --recursive --force /\n');
    assert.ok(findings.some((f) => f.why === 'destructive:rm-rf-root' && f.confidence === 'high'));
  });

  it('does not flag Dockerfile apt-cache cleanup', () => {
    const docker = 'RUN rm -rf /var/lib/apt/lists/*\n';
    const findings = destructiveDetector('Dockerfile', docker);
    assert.equal(findings.filter((f) => f.why === 'destructive:rm-rf-root').length, 0);
  });
});
