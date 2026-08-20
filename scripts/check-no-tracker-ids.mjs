#!/usr/bin/env node
// Guard: no internal tracker IDs (KNO-###, SEC-###) or the trademark TODO may
// appear in committed files. These reference a private issue tracker and must
// not ship in the public tree. Runs in CI and pre-commit; exits non-zero on a
// match so the offending reference is caught before it lands.
//
// Scans tracked files only (`git ls-files`). Reports every match with path,
// line number, and the matched token.
//
// EXEMPTIONS (documented, intentionally narrow — do NOT broaden to src/docs):
//   - docs/plans/**          Historical plan docs legitimately name prior
//                            internal epics; they are project history, not
//                            live pointers, and are kept verbatim.
//   - pnpm-lock.yaml         Generated lockfile; never hand-edited.
//   - this script            Contains the pattern by definition.
//
// docs/security-audit.md is NOT exempted here: it is removed from the tracked
// tree entirely (git rm --cached + .gitignore), so it never reaches this scan.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Matches both real IDs (KNO-123) and the bare placeholder form (KNO-###),
// which the old `\d+` pattern silently let through.
const PATTERNS = [/\b(?:KNO|SEC)-(?:\d+|#+)/g, /TODO\(trademark\)/g];

// Exempted path prefixes / exact paths. Keep this list tight.
const EXEMPT_PREFIXES = ['docs/plans/'];
const EXEMPT_EXACT = new Set([
  'pnpm-lock.yaml',
  'scripts/check-no-tracker-ids.mjs',
]);

function isExempt(path) {
  if (EXEMPT_EXACT.has(path)) return true;
  return EXEMPT_PREFIXES.some((p) => path.startsWith(p));
}

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)
  .filter((p) => !isExempt(p));

const violations = [];
for (const path of tracked) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    continue; // unreadable / deleted — skip
  }
  if (text.includes('\0')) continue; // binary — skip
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        violations.push({ path, line: i + 1, token: m[0] });
      }
    }
  });
}

if (violations.length > 0) {
  console.error(
    `Found ${violations.length} internal tracker reference(s) in tracked files:\n`,
  );
  for (const v of violations) {
    console.error(`  ${v.path}:${v.line}  ${v.token}`);
  }
  console.error(
    '\nStrip the tracker ID (keep the rationale) or delete the bare pointer.',
  );
  console.error('See scripts/check-no-tracker-ids.mjs for the exemption list.');
  process.exit(1);
}

console.log('OK: no internal tracker IDs in tracked files.');
