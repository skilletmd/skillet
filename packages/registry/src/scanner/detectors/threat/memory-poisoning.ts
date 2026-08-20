// Memory-poisoning markers.
//
// A skill that tries to install a persistent override ("remember this for all
// future sessions"), stuff/overflow the context window to evict the system
// prompt, or wipe/rewrite the agent's memory and identity. These are
// prose-intent and run on the instruction surface; confidence is `low`
// (advisory) except the explicit "displace/overwrite the system prompt" and
// "inject false memories" shapes, which are `medium` — still non-blocking, in
// keeping with the flag-only launch posture.

import type { Detector, Finding } from '../../types.js';
import { runPattern } from '../util.js';

const PATTERNS = [
  // MP1 — persistent context injection.
  {
    category: 'memory-poisoning' as const,
    detector: 'remember-across-sessions',
    confidence: 'low' as const,
    pattern:
      /\b(?:always\s+)?remember\s+(?:this|that|the\s+following)\s+(?:for|in)\s+(?:all|every|future)\s+(?:interactions?|conversations?|sessions?|responses?)\b/gi,
  },
  {
    category: 'memory-poisoning' as const,
    detector: 'persist-into-memory',
    // Medium: an explicit "store the following in your memory" instruction is a
    // real memory-poisoning attempt, and low no longer flags (rollup change).
    // The verb+object phrasing is specific enough that it produced zero benign
    // hits on the mirror corpus.
    confidence: 'medium' as const,
    pattern:
      /\b(?:store|save|persist|retain|inject|insert|embed|implant)\s+(?:this|the\s+following)\s+(?:in|to|into|across)\s+(?:your\s+)?(?:memory|context|state|knowledge)\b/gi,
  },
  {
    category: 'memory-poisoning' as const,
    detector: 'permanent-override',
    confidence: 'low' as const,
    pattern:
      /\b(?:from\s+now\s+on|henceforth|going\s+forward|permanently)\s*[,:]?\s*(?:always|you\s+must|you\s+should|you\s+will)\b|\b(?:this\s+is\s+)?(?:a\s+)?(?:permanent|persistent|lasting)\s+(?:instruction|directive|rule|override)\b/gi,
  },
  // MP2 — context-window stuffing / eviction of the original prompt.
  {
    category: 'memory-poisoning' as const,
    detector: 'evict-system-prompt',
    confidence: 'medium' as const,
    pattern:
      /\b(?:displace|push\s+out|overwrite|crowd\s+out|evict)\s+(?:the\s+)?(?:original|system|previous|existing|safety)\s+(?:instructions?|prompt|context|rules?)\b/gi,
  },
  {
    category: 'memory-poisoning' as const,
    detector: 'context-stuffing',
    confidence: 'low' as const,
    pattern:
      /\b(?:fill|pad|stuff|flood|saturate)\s+(?:the\s+)?(?:context|memory|input|prompt|window|buffer)\b|\b(?:exhaust|overflow|exceed)\s+(?:the\s+)?(?:context|token|memory)\s+(?:window|limit|budget|capacity)\b/gi,
  },
  // MP3 — memory manipulation / identity rewrite.
  {
    category: 'memory-poisoning' as const,
    detector: 'wipe-memory',
    confidence: 'low' as const,
    pattern:
      /\b(?:clear|reset|wipe|erase|purge)\s+(?:your\s+)?(?:memory|context|history|conversation)\b|\b(?:overwrite|replace|substitute)\s+(?:your\s+)?(?:memory|context|instructions?|rules?)\b/gi,
  },
  {
    category: 'memory-poisoning' as const,
    detector: 'inject-false-memory',
    confidence: 'medium' as const,
    pattern:
      /\b(?:inject|insert|plant)\s+(?:false|fake|fabricated|malicious)\s+(?:memories?|information|context|data|history)\b|\b(?:poison|contaminate|corrupt|taint)\s+(?:your\s+)?(?:memory|context|state|knowledge|training)\b/gi,
  },
];

export const memoryPoisoningDetector: Detector = (filePath, contents) => {
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  return out;
};
