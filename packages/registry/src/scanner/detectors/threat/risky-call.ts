// AST-backed risky-call detector.
//
// Higher precision than regex for exec/eval/subprocess shapes on script files.
// Markdown and docs are skipped via isScriptFile — prose mentioning exec() must
// not trip this detector.

import type { Detector, Finding } from '../../types.js';
import { isScriptFile } from '../util.js';
import { findJavaScriptRiskyCalls, jsCallSnippet } from '../ast/javascript-calls.js';
import { findPythonRiskyCalls, pythonCallSnippet } from '../ast/python-calls.js';

const JS_EXT = /\.(?:js|cjs|mjs|ts|tsx|jsx)$/i;
const PY_EXT = /\.py$/i;

// risky-call shapes (exec/eval/os.system, subprocess, shell=True) are DUAL-USE:
// ubiquitous in legitimate tooling (test harnesses, plugin/grader loaders), so
// they WARN rather than block. The genuinely dangerous form — executing model
// output or untrusted input — is caught at block tier by the output-handling
// detector. We therefore cap this whole category at `medium` (advisory): a
// visible signal for installers without forbidding well-built, official skills.
const warnCap = (c: Finding['confidence']): Finding['confidence'] => (c === 'high' ? 'medium' : c);

export const riskyCallDetector: Detector = (filePath, contents) => {
  if (!isScriptFile(filePath)) return [];

  const findings: Finding[] = [];

  if (JS_EXT.test(filePath)) {
    for (const site of findJavaScriptRiskyCalls(contents, filePath)) {
      const { lineStart, lineEnd, snippet } = jsCallSnippet(contents, site.offset, site.length);
      findings.push({
        category: 'risky-call',
        confidence: warnCap(site.confidence),
        file: filePath,
        lineStart,
        lineEnd,
        snippet,
        why: `risky-call:${site.detector}`,
      });
    }
  }

  if (PY_EXT.test(filePath)) {
    for (const site of findPythonRiskyCalls(contents)) {
      const { lineStart, lineEnd, snippet } = pythonCallSnippet(contents, site.offset, site.length);
      findings.push({
        category: 'risky-call',
        confidence: warnCap(site.confidence),
        file: filePath,
        lineStart,
        lineEnd,
        snippet,
        why: `risky-call:${site.detector}`,
      });
    }
  }

  return findings;
};
