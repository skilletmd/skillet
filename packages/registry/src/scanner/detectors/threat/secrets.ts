// Secret-shaped strings that we hard-block at publish time (synchronous gate,
// runs BEFORE the version insert). Distinct from the async post-publish
// detectors: a true-positive hit here means a live credential was about to
// land in a shared bundle. The check is intentionally narrow — every pattern
// targets a CHECKSUMMED or otherwise distinctive shape so placeholder values
// (`AKIA…`, `sk-XXXXX…`) don't trigger it.
//
// Lower-confidence "this might be a secret" signal is the client-side privacy
// scan's job (@skillet/core/privacy). This file's only output is the publish-time
// 422 gate.

import type { Finding, Detector } from '../../types.js';
import { runPattern } from '../util.js';

const PATTERNS = [
  {
    category: 'secret' as const,
    detector: 'aws-access-key-live',
    confidence: 'high' as const,
    // AKIA + 16 base32-ish chars — IAM key shape. The placeholder filter
    // rejects values where the body chars are all repeating or all 'X'.
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    accept: (m: RegExpExecArray) => {
      const tail = m[1].slice(4);
      if (/^X+$/i.test(tail)) return false;
      if (/^(.)\1+$/.test(tail)) return false;
      // Reject all-letter or all-digit forms used in docs.
      if (/^[0-9]+$/.test(tail)) return false;
      if (/^[A-Z]+$/.test(tail)) return false;
      return true;
    },
  },
  {
    category: 'secret' as const,
    detector: 'github-pat-classic',
    confidence: 'high' as const,
    // ghp_/gho_/ghs_/ghr_ + 36 base62 chars + 6-char CRC32 suffix on real keys.
    // We accept any 36-char tail with a real entropy mix to avoid hitting
    // doc placeholders like ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.
    pattern: /\b((?:ghp|gho|ghs|ghr)_[A-Za-z0-9]{36})\b/g,
    accept: (m: RegExpExecArray) => {
      const body = m[1].slice(4);
      if (/^X+$/i.test(body)) return false;
      if (/^(.)\1+$/.test(body)) return false;
      // Real PATs aren't all-lowercase. Reject all-same-case to drop the
      // common all-x / all-0 placeholders without flagging real keys.
      if (/^[a-z]+$/.test(body)) return false;
      if (/^[A-Z]+$/.test(body)) return false;
      // Need a mix of letters and digits.
      const hasDigit = /[0-9]/.test(body);
      const hasAlpha = /[A-Za-z]/.test(body);
      return hasDigit && hasAlpha;
    },
  },
  {
    category: 'secret' as const,
    detector: 'github-pat-fine-grained',
    confidence: 'high' as const,
    pattern: /\b(github_pat_[A-Za-z0-9_]{82})\b/g,
  },
  {
    category: 'secret' as const,
    detector: 'openai-api-key',
    confidence: 'high' as const,
    // sk-… 40+ chars. Reject all-x placeholders.
    pattern: /\b(sk-(?:proj-)?[A-Za-z0-9_-]{40,})\b/g,
    accept: (m: RegExpExecArray) => {
      const body = m[1].replace(/^sk-(?:proj-)?/, '');
      if (/^X+$/i.test(body)) return false;
      if (/^(.)\1+$/.test(body)) return false;
      if (/^[0-9]+$/.test(body)) return false;
      if (/^[A-Za-z]+$/.test(body)) return false;
      return true;
    },
  },
  {
    category: 'secret' as const,
    detector: 'anthropic-api-key',
    confidence: 'high' as const,
    pattern: /\b(sk-ant-[A-Za-z0-9_-]{40,})\b/g,
    accept: (m: RegExpExecArray) => {
      const body = m[1].slice(7);
      if (/^X+$/i.test(body)) return false;
      if (/^(.)\1+$/.test(body)) return false;
      return true;
    },
  },
  {
    category: 'secret' as const,
    detector: 'slack-bot-token-live',
    confidence: 'high' as const,
    pattern: /\b(xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[A-Za-z0-9]{24,34})\b/g,
  },
  {
    category: 'secret' as const,
    detector: 'pem-private-key',
    confidence: 'high' as const,
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    category: 'secret' as const,
    detector: 'stripe-secret-live',
    confidence: 'high' as const,
    pattern: /\b(sk_live_[A-Za-z0-9]{24,})\b/g,
  },
  {
    category: 'secret' as const,
    detector: 'google-api-key',
    confidence: 'high' as const,
    pattern: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
    accept: (m: RegExpExecArray) => {
      const body = m[1].slice(4);
      if (/^X+$/i.test(body)) return false;
      if (/^(.)\1+$/.test(body)) return false;
      return true;
    },
  },
  // ── Advisory (medium) secret SHAPES ──────────────────────────────────────
  // Anchored on a credential variable name or the `Bearer` scheme rather than a
  // checksummed vendor format. These are inherently FP-prone (a documented
  // `api_key: "sk_test_…"` example matches their shape), so they are MEDIUM
  // confidence: they FLAG (a non-blocking advisory the author sees) but never
  // hard-block the publish — `secretsBlockingScan` only returns `high` hits, and
  // the async rollup maps medium → `flagged`, not `quarantined`. This restores
  // the coverage the retired client scanner had for these categories (bearer,
  // generic api-key, aws-secret-access-key) WITHOUT its false-positive hard
  // block. `rejectsPlaceholder` keeps obvious example values (all-X, all-one
  // -char/case, no-entropy) clean so docs don't light up.
  {
    category: 'secret' as const,
    detector: 'aws-secret-access-key',
    confidence: 'medium' as const,
    // A recognisable variable name + exactly 40 base64 chars (the AWS secret
    // shape). The name anchor keeps a bare 40-char string from tripping it.
    pattern:
      /(?:aws_?secret_?(?:access_?)?key|SecretAccessKey)["']?\s*[=:]\s*["']?([A-Za-z0-9+/]{40})(?![A-Za-z0-9+/])/gi,
    accept: (m: RegExpExecArray) => hasSecretEntropy(m[1]),
  },
  {
    category: 'secret' as const,
    detector: 'bearer-token',
    confidence: 'medium' as const,
    // `Bearer ` + 20+ token chars. Require entropy so `Bearer <token>` prose and
    // all-placeholder examples don't flag.
    pattern: /\bBearer\s+([A-Za-z0-9\-._~+/]{20,}=*)/g,
    accept: (m: RegExpExecArray) => hasSecretEntropy(m[1]),
  },
  {
    category: 'secret' as const,
    detector: 'generic-api-key',
    confidence: 'medium' as const,
    // A credential-ish variable name + 20+ value chars. Unbounded upper length
    // ({20,} not {20,64}) so a long token (e.g. a JWT assigned to api_key) still
    // matches — a capped quantifier plus a boundary would fail to match at all
    // on an over-length value. Greedy match already stops at the first char
    // outside the value class (the closing quote / whitespace).
    pattern:
      /(?:api[_-]?key|apikey|api[_-]?secret|access[_-]?token|auth[_-]?token|client[_-]?secret|refresh[_-]?token|secret[_-]?key)["']?\s*[=:]\s*["']?([A-Za-z0-9\-._+/]{20,})/gi,
    // Reject a code REFERENCE assigned to a credential name — `const accessToken =
    // credential.accessToken` reads a token from an SDK result, it is not a
    // literal secret. A real secret literal is opaque; a dotted identifier
    // (`obj.prop`, `process.env.X`) is code. This was the single largest FP source
    // (auth-SDK example docs). Quoted/opaque literals still pass through to the
    // entropy gate.
    accept: (m: RegExpExecArray) => !looksLikeCodeReference(m[1]) && hasSecretEntropy(m[1]),
  },
];

// A dotted identifier chain (`credential.accessToken`, `process.env.API_KEY`) is
// a code reference, not a literal secret value. Real secrets are opaque tokens
// with no property-access structure. Kept narrow: only the dotted-identifier
// shape, so an unquoted env-style literal (`API_KEY=aB3x…`) still flags.
function looksLikeCodeReference(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(value);
}

// Distinguish a real credential value from a placeholder or a prose word, for
// the ADVISORY (flag, non-blocking) tier. Rejecting obvious placeholders (all-X,
// all-one-char, common placeholder words) and requiring at least two character
// classes keeps documented example keys (`sk-XXXX…`, `YOUR_API_KEY`, `<token>`)
// out of the advisory tier so `references/` docs stay clean, WITHOUT the earlier
// digit-required rule that silently dropped all-letter real secrets.
const PLACEHOLDER_WORD =
  /^(?:your|example|placeholder|changeme|change_me|redacted|dummy|sample|test|fake|xxx|todo|insert|put|my)/i;
function hasSecretEntropy(raw: string): boolean {
  // Strip separators so `sk-XXXX-XXXX` reads as its body for the placeholder check.
  const body = raw.replace(/[-._~+/=]/g, '');
  if (body.length < 16) return false; // too short to be a real secret value
  if (/^(.)\1+$/.test(body)) return false; // all one character
  // A long run of one character is a placeholder (`sk-XXXXXXXX…`, `key-00000…`);
  // a real high-entropy secret never repeats a char 8+ times in a row.
  if (/(.)\1{7,}/.test(body)) return false;
  if (PLACEHOLDER_WORD.test(body)) return false; // YOUR_API_KEY, EXAMPLE_TOKEN, …
  // Real secrets carry entropy: at least two of {lowercase, uppercase, digit}.
  // Catches all-letter mixed-case keys the old digit-only rule missed.
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((re) => re.test(body)).length;
  return classes >= 2;
}

export const secretsDetector: Detector = (filePath, contents) => {
  const out: Finding[] = [];
  for (const p of PATTERNS) out.push(...runPattern(filePath, contents, p));
  return out;
};
