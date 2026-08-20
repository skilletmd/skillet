// System-prompt leakage markers.
//
// A skill that instructs the agent to reveal, repeat, encode, or exfiltrate its
// own system prompt / instructions. These are prose-intent patterns that run on
// the instruction surface (markdown), so confidence is capped at `medium`:
// security documentation can describe these attacks, and the flag tier is a
// non-blocking advisory badge. The tool-based exfiltration variant (P8 → send
// the prompt to an external URL) is the strongest signal but still `medium`,
// because auto-quarantine is off at launch and prose never auto-blocks.

import type { Detector, Finding } from '../../types.js';
import { runPattern, notDefensive } from '../util.js';

const PATTERNS = [
  // P6 — direct extraction. The ambiguous objects (instructions/rules/…) require
  // a system-scope qualifier (system/hidden/internal) so benign "display
  // instructions to user" (setup steps) doesn't read as a prompt-leak; a bare
  // "prompt" is specific enough to match on its own.
  {
    category: 'prompt-leak' as const,
    detector: 'reveal-system-prompt',
    confidence: 'medium' as const,
    pattern:
      /\b(?:print|output|show|display|reveal|expose|echo|repeat|dump)\s+(?:your\s+|the\s+)?(?:full\s+)?(?:hidden|internal|system)\s+(?:prompt|instructions?|rules?|guidelines?|directives?|config(?:uration)?)\b|\b(?:print|output|show|reveal|expose|echo|dump)\s+(?:your\s+|the\s+)?(?:full\s+)?(?:system\s+)?prompt\b/gi,
    accept: notDefensive,
  },
  {
    category: 'prompt-leak' as const,
    detector: 'disclose-hidden-prompt',
    confidence: 'medium' as const,
    pattern:
      /\b(?:share|disclose|leak|give\s+me)\s+(?:your\s+)?(?:internal|hidden|system|secret)\s+(?:prompt|instructions?|rules?|config)\b/gi,
  },
  {
    category: 'prompt-leak' as const,
    detector: 'output-text-above',
    confidence: 'low' as const,
    pattern:
      /\b(?:output|print|display|repeat|recite|reproduce)\s+(?:the\s+)?(?:text|content|message|everything|all)\s+(?:above|before|prior|preceding)\b/gi,
  },
  // P7 — indirect extraction (encode / translate / reformat the prompt).
  {
    category: 'prompt-leak' as const,
    detector: 'encode-system-prompt',
    confidence: 'medium' as const,
    pattern:
      /\b(?:encode|encrypt|rot13|base64|reverse|summarize|paraphrase|translate)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|rules?)\b/gi,
  },
  // P8 — tool-based exfiltration of the prompt.
  {
    category: 'prompt-leak' as const,
    detector: 'exfil-system-prompt',
    confidence: 'medium' as const,
    pattern:
      /\b(?:send|post|upload|transmit|pipe|forward)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|rules?)\s+(?:to|via|through)\s+(?:https?:\/\/|external|remote|webhook|api|server|curl|wget|fetch)/gi,
  },
  {
    category: 'prompt-leak' as const,
    detector: 'persist-system-prompt',
    confidence: 'low' as const,
    pattern:
      /\b(?:write|save|store|log|dump)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|rules?)\s+(?:to|into|in)\s+(?:a\s+)?(?:file|disk|log|database|storage)\b/gi,
  },
];

export const promptLeakDetector: Detector = (filePath, contents) => {
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  return out;
};
