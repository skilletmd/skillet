// Tool-misuse markers.
//
// Dangerous parameterization of otherwise-legitimate tools: spawning a shell
// (`shell=True`), disabling TLS/cert verification, world-writable modes, force
// flags that skip safety checks, and command chaining that smuggles a fetch|sh.
// These are config/code shapes, so they are script-gated (markdown catalog is
// never touched) and capped at `medium` — they are advisory smells, not
// auto-block triggers (a `--force` push is risky, not malware).

import type { Detector, Finding } from '../../types.js';
import { runPattern, isScriptFile } from '../util.js';

const onlyScripts = (_m: RegExpExecArray, file: string) => isScriptFile(file);

const PATTERNS = [
  // TM1 — dangerous tool parameters / force flags.
  {
    category: 'tool-misuse' as const,
    detector: 'shell-true',
    confidence: 'medium' as const,
    pattern: /\b(?:subprocess\.\w+|Popen)\s*\([^)]*shell\s*=\s*True\b/g,
    accept: onlyScripts,
  },
  {
    category: 'tool-misuse' as const,
    detector: 'force-skip-flag',
    confidence: 'medium' as const,
    // --no-verify, --skip-validation, --allow-unsafe, --force delete/push/reset
    pattern:
      /--no-?(?:verify|check|validate|confirm|protect|safe)\b|--skip-?(?:validation|verification|checks?|auth|tests?)\b|--allow-?(?:empty|root|unrelated|unsafe)\b|--force\s+(?:delete|remove|push|reset|clean)\b/gi,
    accept: onlyScripts,
  },
  {
    category: 'tool-misuse' as const,
    detector: 'git-destructive-flag',
    confidence: 'medium' as const,
    pattern: /\bgit\s+push\s+[^\n|]*--force\b|\bgit\s+reset\s+--hard\b|\bgit\s+clean\s+-[fd]+x\b/gi,
    accept: onlyScripts,
  },
  {
    category: 'tool-misuse' as const,
    detector: 'insecure-transport-flag',
    confidence: 'medium' as const,
    // curl -k/--insecure, wget --no-check-certificate
    pattern: /\bcurl\s+[^|\n]*(?:-k\b|--insecure\b)|\bwget\s+[^|\n]*--no-check-certificate\b/gi,
    accept: onlyScripts,
  },
  // TM2 — command chaining that smuggles a fetch|sh or privilege bump.
  {
    category: 'tool-misuse' as const,
    detector: 'chain-fetch-shell',
    confidence: 'medium' as const,
    pattern: /(?:&&|;)\s*(?:curl|wget)\s+[^|\n]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/gi,
    accept: onlyScripts,
  },
  {
    category: 'tool-misuse' as const,
    detector: 'pipe-to-privileged',
    confidence: 'medium' as const,
    pattern: /\|\s*(?:sudo|su)\s+/g,
    accept: onlyScripts,
  },
  // TM3 — unsafe defaults: disabled verification / auth.
  {
    category: 'tool-misuse' as const,
    detector: 'tls-verify-disabled',
    confidence: 'medium' as const,
    // verify=False, ssl_verify=0, NODE_TLS_REJECT_UNAUTHORIZED=0
    pattern:
      /\b(?:ssl|tls)[_.]?verify\s*=\s*(?:False|false|0|off|no|disable)\b|\bverify\s*=\s*False\b|\bNODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]?0['"]?/g,
    accept: onlyScripts,
  },
  {
    category: 'tool-misuse' as const,
    detector: 'auth-disabled',
    confidence: 'medium' as const,
    pattern:
      /\b(?:require[_-]?auth|auth[_-]?required|check[_-]?auth)\s*=\s*(?:False|false|0|no|off)\b|\b(?:allow[_-]?anonymous|anonymous[_-]?access)\s*=\s*(?:True|true|1|yes|on)\b/g,
    accept: onlyScripts,
  },
];

export const toolMisuseDetector: Detector = (filePath, contents) => {
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  return out;
};
