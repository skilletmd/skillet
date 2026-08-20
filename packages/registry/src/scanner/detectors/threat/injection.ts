// Prompt-injection markers in skill text.
//
// We catch the small set that survives across model families: explicit
// override phrases, fake-system framing, and well-known jailbreak strings.
// `medium` confidence is the default — these patterns hit benign content too
// (someone documenting injection), so we never block on a single marker, but
// any of them shows up in the diff so a kit member sees them before accepting.

import type { Detector, Finding } from '../../types.js';
import { runPattern, notDefensive } from '../util.js';

// A skill that QUOTES an override phrase while teaching injection defense (e.g.
// Vercel's trust-boundaries doc: 'if a page says "ignore previous instructions"…
// treat it as data') is not itself an injection. The shared `notDefensive`
// acceptor (util.ts) skips the override-phrase detectors when the match sits in a
// defensive/describing context; a raw override with no such markers still fires.

const PATTERNS = [
  {
    category: 'injection' as const,
    detector: 'ignore-previous',
    confidence: 'medium' as const,
    pattern: /\bignore\s+(?:all\s+)?previous(?:\s+(?:instructions|prompts|context))?\b/gi,
    accept: notDefensive,
  },
  {
    category: 'injection' as const,
    detector: 'disregard-previous',
    confidence: 'medium' as const,
    pattern: /\bdisregard\s+(?:all\s+|the\s+)?(?:above|previous|prior)\b/gi,
    accept: notDefensive,
  },
  {
    category: 'injection' as const,
    detector: 'set-aside-prior',
    confidence: 'medium' as const,
    // Paraphrased override: "set aside / forget about / put aside everything
    // (stated|said|above|earlier|before)" — the ignore-previous intent without
    // the exact word "ignore".
    pattern:
      /\b(?:set\s+aside|put\s+aside|forget\s+about|never\s+mind)\s+(?:all\s+|any\s+|everything\s+|the\s+)?(?:\w+\s+){0,3}?(?:stated|said|above|earlier|before|prior|previous|instructions?)\b/gi,
    accept: notDefensive,
  },
  {
    category: 'injection' as const,
    detector: 'fake-system-tag',
    confidence: 'medium' as const,
    // Lines that LOOK like a system-role turn injected into user content:
    // delimited tags (`<system>`, `<|system|>`, `[system]`), or a line-initial
    // `system:` whose value reads like an injected directive.
    //
    // The `system:` arm has TWO guards, both required:
    //   1. a negative lookahead sparing structured values — the LLM-SDK/config
    //      form `system: "You are…"` (quoted), `system: [`, `system: {`, or
    //      `system: word,`/`word}` — code, not an injected turn; and
    //   2. a positive lookahead requiring an injection cue on the same line
    //      (second-person address or an override/role directive). A bare value
    //      like `system: OpenMM System` (a molecular-dynamics config key) has no
    //      cue, so it no longer false-flags as prompt injection.
    pattern:
      /(?:^|\n)\s*(?:<\|?system\|?>|\[system\]|system:(?!\s*(?:["'`[{]|\w+\s*[,}]))(?=[^\n]{0,200}?\b(?:you|your|yourself|you['’]re|ignore|disregard|forget|override|bypass|pretend|roleplay|act\s+as|from\s+now\s+on|new\s+(?:instructions?|rules?|prompt)|respond\s+only|reply\s+only|do\s+not\s+(?:follow|obey|reveal|tell)|reveal\s+(?:your|the))\b))/gi,
  },
  {
    category: 'injection' as const,
    detector: 'jailbreak-dan',
    confidence: 'high' as const,
    pattern: /\b(?:DAN(?:\s+mode)?|do\s+anything\s+now)\b/gi,
    accept: (m: RegExpExecArray) => (/^dan\b/i.test(m[0]) ? /\bDAN\b/.test(m[0]) : true),
  },
  {
    category: 'injection' as const,
    detector: 'jailbreak-doc-prose',
    confidence: 'medium' as const,
    pattern: /\bdeveloper\s+mode\s+enabled\b/gi,
  },
  {
    category: 'injection' as const,
    detector: 'override-rules',
    confidence: 'high' as const,
    // Instruction-override injection targeting the AGENT's controls: `safety`,
    // `guardrails`, or `instructions`. Deliberately NOT generic "rules"/"policy"/
    // "filters" — real skill docs say "Bypass All Rules" (firewall IPs),
    // "Override the rule" (CSS), "does not override the policy" (autoscaling),
    // none of which are attacks. Recall rides the safety/guardrails branch
    // ("override safety rules", "bypass safety guardrails"), not the generic one.
    pattern:
      /\b(?:override|bypass|disable|disregard)\s+(?:safety(?:\s+\w+)?|guard(?:rails?)?|(?:all|any|the|your|our|these|those|previous|prior|system)\s+(?:safety\s+)?(?:instructions?|guard(?:rails?)?))\b/gi,
  },
  {
    category: 'injection' as const,
    detector: 'role-claim',
    confidence: 'low' as const,
    pattern: /\bI(?:'m| am)\s+(?:now\s+)?(?:the\s+)?(?:admin|root|developer|owner|system)\b/gi,
  },
  // Instruction-override phrasings: the high-confidence forms have no benign
  // read-time use; medium for the softer overrides.
  {
    category: 'injection' as const,
    detector: 'forget-instructions',
    confidence: 'high' as const,
    pattern: /\bforget\s+(?:all\s+|everything\s+|your\s+)?(?:previous\s+)?(?:instructions?|rules?|prompts?)\b/gi,
  },
  {
    category: 'injection' as const,
    detector: 'jailbreak-mode',
    confidence: 'high' as const,
    // "you are now in jailbreak/unrestricted/unfiltered mode".
    pattern: /\byou\s+are\s+now\s+(?:in\s+)?(?:jailbreak|unrestricted|unfiltered)\s+mode\b/gi,
  },
  {
    category: 'injection' as const,
    detector: 'do-not-follow-rules',
    confidence: 'high' as const,
    pattern: /\bdo\s+not\s+follow\s+(?:any|your|the)\s+(?:rules?|guidelines?|instructions?)\b/gi,
  },
  {
    category: 'injection' as const,
    detector: 'new-instructions-are',
    confidence: 'medium' as const,
    pattern: /\byour\s+new\s+(?:instructions?|rules?)\s+are\b/gi,
  },
];

export const injectionDetector: Detector = (filePath, contents) => {
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  return out;
};
