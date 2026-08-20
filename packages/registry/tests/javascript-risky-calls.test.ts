import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findJavaScriptRiskyCalls } from '../src/scanner/detectors/ast/javascript-calls.js';

describe('javascript risky-call AST', () => {
  it('flags top-level import exec', () => {
    const src = `import { exec } from 'child_process';\nexec('whoami');`;
    const sites = findJavaScriptRiskyCalls(src, 'run.js');
    assert.ok(sites.some((s) => s.detector.includes('child-process-exec')));
  });

  it('flags function-scoped require binding', () => {
    const src = `function f() {\n  const cp = require('child_process');\n  cp.exec('x');\n}`;
    const sites = findJavaScriptRiskyCalls(src, 'run.js');
    assert.ok(sites.some((s) => s.detector.includes('child-process-exec')));
  });

  it('flags inline require().exec', () => {
    const src = `require('child_process').exec('x');`;
    const sites = findJavaScriptRiskyCalls(src, 'run.js');
    assert.ok(sites.some((s) => s.detector.includes('child-process-exec')));
  });

  it('flags computed member when cp binds to child_process', () => {
    const src = `const cp = require('child_process');\ncp['exec']('x');`;
    const sites = findJavaScriptRiskyCalls(src, 'run.js');
    assert.ok(sites.some((s) => s.detector.includes('child-process-exec')));
  });

  it('does not flag RegExp.prototype.exec shadow', () => {
    const src = `const re = /a/;\nre.exec('abc');`;
    const sites = findJavaScriptRiskyCalls(src, 'run.js');
    assert.equal(sites.length, 0);
  });
});
