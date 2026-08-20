#!/usr/bin/env node
// Guard: this machine's identity (computer name, hostname, OS username) must
// not seep into commits. Agents debugging device flows see the real machine
// label in `device.json` / `skillet devices` output and it ends up pasted into
// test fixtures, mock data, and comments (this happened: a laptop's name
// shipped in six files, and a build machine's hostname landed in commit
// authorship as user@host). Fixtures use canonical labels ('test-machine').
//
// The identifiers are computed at runtime on THIS machine, so the hook works
// for every contributor without hardcoding anyone's hostname in the repo.
//
// Modes:
//   (default)          scan lines ADDED in the staged diff (pre-commit)
//   --message <file>   scan a commit-message file (commit-msg)
//
// Identifiers shorter than MIN_LENGTH or in the generic denylist are skipped —
// a username like "sam" or a computer named "MacBook Pro" would flag half the
// tree. That means short names get no protection; the canonical-fixture rule
// in CLAUDE.md is the backstop.
//
// Escape hatch for a deliberate mention: SKILLET_ALLOW_MACHINE_NAME=1 git commit …

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';

const MIN_LENGTH = 4;
const GENERIC = new Set([
  'localhost',
  'macbook',
  'macbook pro',
  'macbook air',
  'imac',
  'mac mini',
  'mac studio',
  'desktop',
  'laptop',
  'ubuntu',
  'debian',
  'fedora',
  'windows',
  'admin',
  'user',
  'test',
  'runner',
]);

function macComputerName() {
  if (process.platform !== 'darwin') return null;
  try {
    return execFileSync('scutil', ['--get', 'ComputerName'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function localIdentifiers() {
  const fullHost = hostname().trim();
  const raw = [
    macComputerName(),
    fullHost,
    // Bare machine label too: "macmini.myfiosgateway.com" must also flag a
    // lone "macmini" pasted into a fixture or trailer.
    fullHost.split('.')[0],
    process.env['COMPUTERNAME'],
    process.env['HOSTNAME'],
    userInfo().username,
  ];
  const seen = new Set();
  const out = [];
  for (const value of raw) {
    const v = value?.trim();
    if (!v || v.length < MIN_LENGTH) continue;
    const key = v.toLowerCase();
    if (GENERIC.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function scanLines(lines, identifiers) {
  const hits = [];
  const patterns = identifiers.map((id) => ({
    id,
    // \b breaks on hostnames with leading/trailing punctuation; use manual
    // word-ish boundaries so "devbox" matches but "mydevboxes" would not.
    re: new RegExp(`(^|[^a-z0-9])${escapeRegExp(id)}([^a-z0-9]|$)`, 'i'),
  }));
  for (const { where, text } of lines) {
    for (const { id, re } of patterns) {
      if (re.test(text)) hits.push({ where, id, text: text.trim() });
    }
  }
  return hits;
}

function stagedAddedLines() {
  const diff = execFileSync(
    'git',
    ['diff', '--cached', '--unified=0', '--no-color'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  const lines = [];
  let file = '?';
  let lineNo = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      file = line.slice(6);
    } else if (line.startsWith('@@')) {
      const m = /\+(\d+)/.exec(line);
      lineNo = m ? Number(m[1]) : 0;
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      lines.push({ where: `${file}:${lineNo}`, text: line.slice(1) });
      lineNo += 1;
    }
  }
  return lines;
}

if (process.env['SKILLET_ALLOW_MACHINE_NAME'] === '1') {
  console.log('SKIP: machine-identity check disabled for this commit.');
  process.exit(0);
}

const identifiers = localIdentifiers();
if (identifiers.length === 0) {
  process.exit(0);
}

function gitIdentityLines() {
  // Catches the user@host default identity (unset user.email) and any
  // configured identity that embeds this machine's name — both become the
  // permanent author/committer of every commit and survive squash merges
  // as Co-authored-by trailers.
  const lines = [];
  for (const varName of ['GIT_AUTHOR_IDENT', 'GIT_COMMITTER_IDENT']) {
    try {
      const ident = execFileSync('git', ['var', varName], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      lines.push({ where: `git identity (${varName})`, text: ident });
    } catch {
      // git refuses to compose an ident (no name/email and none derivable);
      // the commit itself will fail with git's own message.
    }
  }
  return lines;
}

const messageArg = process.argv.indexOf('--message');
const lines =
  messageArg !== -1
    ? readFileSync(process.argv[messageArg + 1], 'utf8')
        .split('\n')
        // Comment lines are stripped by git before the message is recorded.
        .filter((l) => !l.startsWith('#'))
        .map((text, i) => ({ where: `commit message:${i + 1}`, text }))
    : [...gitIdentityLines(), ...stagedAddedLines()];

const hits = scanLines(lines, identifiers);
if (hits.length > 0) {
  console.error(
    `This machine's identity would leak into the commit (${hits.length} line(s)):\n`,
  );
  for (const h of hits) {
    console.error(`  ${h.where}  [${h.id}]  ${h.text}`);
  }
  console.error(
    '\nUse a canonical fixture label instead (e.g. \'test-machine\').',
  );
  console.error(
    'Deliberate mention: re-run with SKILLET_ALLOW_MACHINE_NAME=1.',
  );
  process.exit(1);
}
