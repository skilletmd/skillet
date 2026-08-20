#!/usr/bin/env node
// Guard: every `uses: owner/repo@<40-hex>` in .github/workflows must resolve to
// a real upstream commit. A bogus pin fails the workflow in seconds with
// "Unable to resolve action" — invisible until the workflow runs, which for the
// manual and tag-driven ones (desktop-build, release, cli-publish, notarize) is
// the day you are trying to ship. Needs `gh` authenticated; skips politely
// without it so a contributor's local run does not fail on our tooling.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.github/workflows');

try {
  execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
} catch {
  console.log('check-action-pins: skipped (gh not authenticated)');
  process.exit(0);
}

const pins = new Map();
for (const file of readdirSync(DIR)) {
  const text = readFileSync(join(DIR, file), 'utf8');
  for (const m of text.matchAll(/uses:\s*([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([0-9a-f]{40})/g)) {
    const key = `${m[1]}@${m[2]}`;
    if (!pins.has(key)) pins.set(key, []);
    pins.get(key).push(file);
  }
}

const broken = [];
for (const [pin, files] of pins) {
  const [repo, sha] = pin.split('@');
  try {
    execFileSync('gh', ['api', `repos/${repo}/commits/${sha}`, '--jq', '.sha'], { stdio: 'ignore' });
  } catch {
    broken.push({ pin, files });
  }
}

if (broken.length > 0) {
  console.error(`check-action-pins: ${broken.length} unresolvable pin(s):\n`);
  for (const b of broken) console.error(`  ${b.pin}\n    in: ${b.files.join(', ')}`);
  console.error('\nFind the real SHA with: gh api repos/<owner>/<repo>/commits/<tag> --jq .sha');
  process.exit(1);
}

console.log(`check-action-pins: ok (${pins.size} pins resolve)`);
