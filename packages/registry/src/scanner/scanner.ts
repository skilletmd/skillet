// Aggregate scanner: runs every async detector across the text-file subset of
// a decoded bundle and rolls findings up into a status + summary.

import type { DecodedBundle } from '@skillet/protocol';
import { computeInstructionClosure } from '@skillet/protocol';
import { decodeText, isTextFile } from './text-files.js';
import { scanBundle, MAX_DETECT_BYTES } from './scan-engine.js';
import { injectionDetector } from './detectors/threat/injection.js';
import { exfilDetector } from './detectors/threat/exfil.js';
import { destructiveDetector } from './detectors/threat/destructive.js';
import { obfuscationDetector } from './detectors/threat/obfuscation.js';
import { secretsDetector } from './detectors/threat/secrets.js';
import { promptLeakDetector } from './detectors/threat/prompt-leak.js';
import { privilegeEscalationDetector } from './detectors/threat/privilege-escalation.js';
import { supplyChainDetector } from './detectors/threat/supply-chain.js';
import { excessiveAgencyDetector } from './detectors/threat/excessive-agency.js';
import { outputHandlingDetector } from './detectors/threat/output-handling.js';
import { memoryPoisoningDetector } from './detectors/threat/memory-poisoning.js';
import { toolMisuseDetector } from './detectors/threat/tool-misuse.js';
import { rogueAgentDetector } from './detectors/threat/rogue-agent.js';
import { riskyCallDetector } from './detectors/threat/risky-call.js';
import { latexDetector } from './detectors/threat/latex.js';
import { outputInjectionDetector } from './detectors/threat/output-injection.js';
import type {
  Category,
  Detector,
  Finding,
  FindingsSummary,
  ScanResult,
  Severity,
} from './types.js';

// Async post-publish detectors. The synchronous publish-time secret gate runs
// separately — see `secretsBlockingScan`.
export const ASYNC_DETECTORS: Detector[] = [
  injectionDetector,
  exfilDetector,
  destructiveDetector,
  obfuscationDetector,
  secretsDetector,
  // additional categories.
  promptLeakDetector,
  privilegeEscalationDetector,
  supplyChainDetector,
  excessiveAgencyDetector,
  outputHandlingDetector,
  memoryPoisoningDetector,
  toolMisuseDetector,
  rogueAgentDetector,
  riskyCallDetector,
  latexDetector,
  outputInjectionDetector,
];

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2 };

export function summarize(findings: Finding[]): FindingsSummary {
  const counts: FindingsSummary['counts'] = {};
  let top: Severity | null = null;
  for (const f of findings) {
    const cat = (counts[f.category] ??= {});
    cat[f.confidence] = (cat[f.confidence] ?? 0) + 1;
    if (top === null || SEVERITY_RANK[f.confidence] > SEVERITY_RANK[top]) {
      top = f.confidence;
    }
  }
  // Highlight findings: at most one per (category, confidence), ranked high-first.
  const sorted = [...findings].sort(
    (a, b) => SEVERITY_RANK[b.confidence] - SEVERITY_RANK[a.confidence],
  );
  const seen = new Set<string>();
  const highlights: FindingsSummary['highlights'] = [];
  for (const f of sorted) {
    const key = `${f.category}:${f.confidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    highlights.push({
      category: f.category,
      confidence: f.confidence,
      file: f.file,
      why: f.why,
    });
    if (highlights.length >= 5) break;
  }
  return { total: findings.length, counts, topConfidence: top, highlights };
}

function rollupStatus(findings: Finding[]): ScanResult['status'] {
  let hasHigh = false;
  let hasMedium = false;
  for (const f of findings) {
    if (f.confidence === 'high') hasHigh = true;
    else if (f.confidence === 'medium') hasMedium = true;
  }
  if (hasHigh) return 'quarantined';
  // Low findings are informational — they are recorded and shown, but a skill is
  // only FLAGGED by a medium finding (and quarantined by a high). Low was ~100%
  // false-positive on the real corpus; a genuinely-low real threat is graded
  // medium at its detector (see excessive-agency:auto-approve,
  // memory-poisoning:persist-into-memory) so it still surfaces.
  if (hasMedium) return 'flagged';
  return 'clean';
}

// Categories that keep full confidence in EVERY file path — including
// publisher-controlled `references/` and `examples/` trees. A leaked live secret,
// `rm -rf /`, prompt injection, or `curl evil | bash` in a "docs" path is still
// agent-executable once the bundle is materialized; path-based downgrade was an
// evasion vector (see scan-quarantine.test.ts).
const FULL_WEIGHT_ANYWHERE: ReadonlySet<Category> = new Set([
  'destructive',
  'secret',
  'supply-chain',
  'injection',
  'exfil',
  'obfuscation',
  'output-handling',
  'output-injection',
  'rogue-agent',
  'risky-call',
]);

/**
 * A "supporting" file is documentation, examples, or tests — material the agent
 * reads ABOUT, not the executable instructions it runs. SKILL.md and shipped
 * scripts are NOT supporting (full weight). A behavioral heuristic that fires in
 * a supporting file is overwhelmingly a false positive (a `system:` prompt in a
 * code sample, `terraform apply -auto-approve` in product docs), so we cap it at
 * 'low' — it still FLAGS (a visible note) but never QUARANTINES (hides the skill).
 */
function isSupportingFile(path: string): boolean {
  const p = path.toLowerCase();
  // Only files UNDER a docs/examples/tests directory, or named as a test, count.
  // A bare `.md` (SKILL.md, prompt.md, README) can carry the real instructions,
  // so it is never treated as supporting on filename alone.
  return (
    /(^|\/)(references?|docs?|examples?|fixtures?|samples?)\//.test(p) ||
    /(^|\/)tests?\//.test(p) ||
    /\.(test|spec)\.[a-z0-9]+$/.test(p)
  );
}

/**
 * The instruction closure (SKILL.md + everything reachable via transitive
 * `required_reading` frontmatter) is content the agent EAGERLY loads — a
 * "supporting" path like `references/policy.md` listed under required_reading is
 * read AS instructions, so a high-confidence injection/exfil payload there is a
 * real threat, not a documentation false positive. Computing the closure can
 * throw on a malformed bundle (no SKILL.md, dangling required_reading); when it
 * does, fall back to an empty set so weighting behaves exactly as before.
 */
function safeInstructionClosure(bundle: DecodedBundle): Set<string> {
  try {
    return computeInstructionClosure(bundle);
  } catch {
    return new Set<string>();
  }
}

/** Cap behavioral findings in supporting files to 'low' so docs/tests can flag
 *  but never hide a skill. Real-danger categories pass through untouched. Files
 *  in the instruction closure are exempt from the downgrade: the agent loads
 *  them as instructions, so their findings keep full confidence. */
function weighByFileRole(findings: Finding[], instructionClosure: ReadonlySet<string>): Finding[] {
  return findings.map((f) =>
    f.confidence !== 'low' &&
    !FULL_WEIGHT_ANYWHERE.has(f.category) &&
    isSupportingFile(f.file) &&
    !instructionClosure.has(f.file)
      ? { ...f, confidence: 'low' as Severity }
      : f,
  );
}

/**
 * Scan a canonical bundle. Iterates every text file once per detector. Binary
 * files are skipped (recorded in `summary` as `total: 0` if no other findings).
 *
 * Pure: no IO, no clock, deterministic for a given bundle.
 */
export function runScan(bundle: DecodedBundle): ScanResult {
  // Single-pass engine does the walk + decode + per-detector fault isolation;
  // threat post-processing is the finalizer below (shared with the combined scan).
  const { findings } = scanBundle(bundle, { threatDetectors: ASYNC_DETECTORS });
  return finalizeThreatScan(bundle, findings);
}

/**
 * Threat post-processing over raw detector findings: role-weighting, status
 * rollup, summary. Split out of {@link runScan} so the combined single-walk scan
 * (runner) can reuse it on findings the engine already produced.
 */
export function finalizeThreatScan(bundle: DecodedBundle, rawFindings: Finding[]): ScanResult {
  const weighted = weighByFileRole(rawFindings, safeInstructionClosure(bundle));
  return { status: rollupStatus(weighted), findings: weighted, summary: summarize(weighted) };
}

/**
 * Synchronous publish-time secret gate. Returns the first high-confidence
 * secret-shaped finding (so the 422 carries one concrete pointer); returns
 * null when no live-shaped secret is present.
 */
export function secretsBlockingScan(bundle: DecodedBundle): Finding | null {
  const paths = [...bundle.keys()].sort();
  for (const path of paths) {
    const bytes = bundle.get(path)!;
    if (!isTextFile(path, bytes)) continue;
    const decoded = decodeText(bytes);
    // Bound the synchronous pre-insert scan to the same prefix the engine uses,
    // so a pathologically large file can't stall the publish event loop.
    const contents =
      decoded.length > MAX_DETECT_BYTES ? decoded.slice(0, MAX_DETECT_BYTES) : decoded;
    const hits = secretsDetector(path, contents);
    for (const h of hits) {
      if (h.confidence === 'high') return h;
    }
  }
  return null;
}

export type { Category, Finding, FindingsSummary, ScanResult, Severity };
