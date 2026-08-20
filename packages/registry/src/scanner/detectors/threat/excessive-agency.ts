// Excessive-agency markers.
//
// A skill that grants itself unrestricted tools, removes the human-in-the-loop
// ("auto-approve", "without confirmation"), or asks for unbounded resources.
// These are overwhelmingly prose-intent and high-FP (legitimate skills discuss
// confirmation and limits), so confidence is `low` across the board and these
// findings are advisory-only — they surface in the graded diff so a recipient
// sees the agency grab before accepting, never auto-blocking a publish.

import type { Detector, Finding } from '../../types.js';
import { runPattern } from '../util.js';

// Reference / example / test material DESCRIBES agency (a deployment guide that
// says "terraform apply -auto-approve", an architecture doc discussing
// automation) rather than granting it. The real signal — a skill giving ITSELF
// unrestricted agency — lives in SKILL.md and shipped scripts. Suppress these
// advisory markers in supporting docs so a clean skill's trust panel stays
// quiet; they still surface in the primary instructions and in code.
const SUPPORTING_DOC_RE = /(?:^|\/)(?:references?|docs?|examples?|samples?|fixtures?|tests?)\//i;

const PATTERNS = [
  // EA1 — unrestricted tool access.
  {
    category: 'excessive-agency' as const,
    detector: 'wildcard-tool-grant',
    confidence: 'low' as const,
    // tools: * / permissions: ['*'] as a value (not Bash(git *) style scoping).
    pattern: /\b(?:allowed[-_]?tools?|tools?|permissions?)\s*:\s*\[?\s*['"]?\*['"]?\s*\]?\s*(?:$|[,\n])/gim,
  },
  {
    category: 'excessive-agency' as const,
    detector: 'unrestricted-tool-use',
    confidence: 'low' as const,
    pattern:
      /\b(?:unrestricted|unlimited|unconstrained)\s+(?:tool|function|api)\s+(?:access|use|calls?)\b|\b(?:call|invoke|use|execute)\s+(?:any|all|every)\s+(?:available\s+)?tools?\b/gi,
  },
  {
    category: 'excessive-agency' as const,
    detector: 'execute-arbitrary-code',
    confidence: 'low' as const,
    pattern: /\b(?:execute|run)\s+(?:arbitrary|any)\s+(?:commands?|code|scripts?)\b/gi,
  },
  // EA2 — removing the human-in-the-loop.
  {
    category: 'excessive-agency' as const,
    detector: 'auto-approve',
    // Blanket auto-approval only — "auto-approve ALL tool calls" is the threat.
    // Bare "auto-approve" / "auto-deploy" is a deploy/CI concept (terraform
    // -auto-approve, "auto-deploy platforms") or a scoped "auto-approve for the
    // session"; those are not excessive agency. Medium because a genuine
    // blanket-approval instruction is a real signal (see rollup: low no longer
    // flags, so a real threat must be graded medium to surface).
    confidence: 'medium' as const,
    pattern: /\bauto[-_ ]?(?:approve|confirm)\s+(?:all|every|everything|any|each)\b/gi,
  },
  {
    category: 'excessive-agency' as const,
    detector: 'skip-confirmation',
    confidence: 'low' as const,
    pattern:
      /\b(?:skip|bypass|disable)\s+(?:user\s+)?(?:confirmation|approval|consent|verification)\b|\b(?:do\s+not|don't|never)\s+(?:ask|prompt|confirm)\s+(?:the\s+)?(?:user)\b/gi,
  },
  {
    category: 'excessive-agency' as const,
    detector: 'act-without-approval',
    confidence: 'low' as const,
    pattern:
      /\b(?:auto(?:matically)?|autonomously)\s+(?:execute|run|perform|delete|remove|deploy|send)\b|\b(?:proceed|continue|execute)\s+without\s+(?:waiting|asking)\s+(?:for\s+)?(?:user|human|permission)\b/gi,
  },
  // EA4 — unbounded resource access.
  {
    category: 'excessive-agency' as const,
    detector: 'unbounded-loop',
    confidence: 'low' as const,
    pattern:
      /\b(?:loop|iterate|repeat|retry|attempt)\s+(?:indefinitely|forever|infinitely|endlessly|without\s+limit)\b/gi,
  },
];

export const excessiveAgencyDetector: Detector = (filePath, contents) => {
  if (SUPPORTING_DOC_RE.test(filePath)) return [];
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  return out;
};
