/**
 * U5/R5-R10 — the `skillet edits` customized-skills surface. Source-pinned like
 * sync-output.test.ts: always registered (never behind SKILLET_LEGACY_CLI), the
 * `list --json` row shape, and the propose 403/409 outcome mapping tested
 * BEHAVIORALLY through the pure renderProposeOutcome fn (exclusive per status).
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Command } from 'commander';
import type { Adapter, CustomizedSkill, ProposeCustomizedResult } from '@skillet/core';
import { readLiveCustomizedTree } from '@skillet/core';
import { registerAllCommands } from '../src/commands/register-all.js';
import {
  renderProposeOutcome,
  findCustomizedByRef,
  bytesEqual,
  diffTrees,
  diffHunks,
  isText,
  lineDiff,
} from '../src/commands/edits.js';
import { ExitCode } from '../src/exit-codes.js';
import { stripControlChars } from '../src/sanitize-output.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const editsSrc = readFileSync(join(__dirname, '../src/commands/edits.ts'), 'utf8');
const registerAllSrc = readFileSync(join(__dirname, '../src/commands/register-all.ts'), 'utf8');
const legacySrc = readFileSync(
  join(__dirname, '../src/commands/register-management-commands.ts'),
  'utf8',
);

test('edits is ALWAYS registered — in register-all, absent from the legacy gate (R10)', () => {
  const registerIdx = registerAllSrc.indexOf('registerEditsCommand(program)');
  const gateIdx = registerAllSrc.indexOf('if (legacy)');
  assert.ok(registerIdx >= 0, 'registerEditsCommand must be called in register-all');
  assert.ok(gateIdx >= 0);
  assert.ok(registerIdx < gateIdx, 'edits must register unconditionally, before the legacy gate');
  assert.doesNotMatch(legacySrc, /registerEditsCommand/);

  // And functionally: the command exists without legacy management, with the
  // reshaped verb set — no adopt/discard/unpause. `check` is the read-only
  // live-edit scan for the desktop tray; it registers unconditionally too.
  const program = new Command('skillet').version('test');
  registerAllCommands(program, { legacyManagement: false });
  const edits = program.commands.find((c) => c.name() === 'edits');
  assert.ok(edits, 'skillet edits must exist without SKILLET_LEGACY_CLI');
  const subs = edits!.commands.map((c) => c.name()).sort();
  assert.deepEqual(subs, ['check', 'diff', 'keep', 'list', 'propose', 'restore', 'take']);
});

test('the dropped #388 verbs and core fns are gone from the edits surface', () => {
  assert.doesNotMatch(editsSrc, /\badopt\b/);
  assert.doesNotMatch(editsSrc, /\bdiscard\b/);
  assert.doesNotMatch(editsSrc, /\bunpause\b/);
  assert.doesNotMatch(editsSrc, /adoptCapture|unpauseSkill|discardCapture|proposeCapture/);
  // Refusals are data now; the CLI never resolves a capture (there are none).
  assert.doesNotMatch(editsSrc, /resolveCapture/);
});

test('edits list --json rows carry the customized shape (slug, ref, customized:true, hasUpdate, version, held)', () => {
  // The list action emits the row projection under a `customized` envelope key.
  assert.match(editsSrc, /customized:\s*skills\.map\(toRow\)/);
  // toRow projection field set.
  assert.match(editsSrc, /ref:\s*lineageRef\(c\.lineage\)/);
  assert.match(editsSrc, /customized:\s*true/);
  assert.match(editsSrc, /hasUpdate:\s*c\.hasUpdate/);
  assert.match(editsSrc, /version:\s*c\.lineage\.version/);
  assert.match(editsSrc, /c\.held \? \{ held: c\.held \} : \{\}/);
  // Fed from the curated core fn — customized skills key on their lineage ref.
  assert.match(editsSrc, /listCustomized\(\)/);
});

test('diff reads the live edit vs the upstream bundle via the curated core fn (no local re-implementation)', () => {
  assert.match(editsSrc, /readBundleFromSkillStore\(customized\.slug\)/);
  assert.match(editsSrc, /readLiveCustomizedTree\(customized\.slug/);
  // The CLI must not re-implement core's dotfile-tolerant tree read — that
  // duplicate drifted and was missing the .skillet-backup exclusion (P1 fix).
  assert.doesNotMatch(editsSrc, /readLiveTree\(/);
  assert.doesNotMatch(editsSrc, /readTreeSkippingDotfiles/);
});

// ── diff-rendering pure functions, tested BEHAVIORALLY ───────────────────────

function tree(entries: Record<string, string | Uint8Array>): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const [path, val] of Object.entries(entries)) {
    out.set(path, typeof val === 'string' ? Buffer.from(val, 'utf8') : val);
  }
  return out;
}

test('bytesEqual: same content true, different length or bytes false', () => {
  assert.equal(bytesEqual(Buffer.from('abc'), Buffer.from('abc')), true);
  assert.equal(bytesEqual(Buffer.from('abc'), Buffer.from('ab')), false);
  assert.equal(bytesEqual(Buffer.from('abc'), Buffer.from('abd')), false);
});

test('diffTrees: identical trees produce no diff rows', () => {
  const live = tree({ 'SKILL.md': 'hello', 'a/b.txt': 'x' });
  const upstream = tree({ 'SKILL.md': 'hello', 'a/b.txt': 'x' });
  const rows = diffTrees(live, upstream);
  assert.ok(rows.every((r) => r.status === 'unchanged'));
});

test('diffTrees: added, removed, and changed files get the correct status', () => {
  const live = tree({ 'SKILL.md': 'v2', 'only-live.txt': 'x' });
  const upstream = tree({ 'SKILL.md': 'v1', 'only-upstream.txt': 'y' });
  const rows = diffTrees(live, upstream);
  const byPath = Object.fromEntries(rows.map((r) => [r.path, r.status]));
  assert.equal(byPath['SKILL.md'], 'changed');
  assert.equal(byPath['only-live.txt'], 'added');
  assert.equal(byPath['only-upstream.txt'], 'removed');
});

test('diffHunks: emits structured del(theirs)/add(yours) lines with context', () => {
  // old = upstream (theirs), new = live (yours)
  const hunks = diffHunks('line1\nold\nline3', 'line1\nnew\nline3');
  const del = hunks.find((h) => h.kind === 'del');
  const add = hunks.find((h) => h.kind === 'add');
  assert.equal(del?.text, 'old');
  assert.equal(add?.text, 'new');
  assert.ok(hunks.some((h) => h.kind === 'ctx' && h.text === 'line1'));
});

test('diffTrees: a .skillet-backup file present in the live tree does not surface as a diff row (P1 regression)', async () => {
  // The old CLI-local reader was missing this exclusion (the drifted dup);
  // core's readLiveCustomizedTree has it. Exercise the REAL core fn against a
  // real on-disk tree so the regression is pinned end-to-end, not just at the
  // diffTrees level (which has no dotfile knowledge of its own).
  const dir = await mkdtemp(join(tmpdir(), 'skillet-edits-diff-'));
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'SKILL.md'), 'hello', 'utf8');
    await writeFile(join(dir, 'SKILL.md.skillet-backup'), 'stale-backup-bytes', 'utf8');
    const fakeAdapter = {
      kind: 'global',
      targetSkillDir: () => dir,
    } as unknown as Adapter;
    const live = await readLiveCustomizedTree('some-skill', null, [fakeAdapter]);
    assert.ok(live, 'expected a live tree to be read');
    assert.ok(!live!.has('SKILL.md.skillet-backup'), 'backup file must be excluded from the live tree');
    const rows = diffTrees(live!, tree({ 'SKILL.md': 'hello' }));
    assert.ok(
      !rows.some((r) => r.path === 'SKILL.md.skillet-backup'),
      'backup file must not appear as a diff row',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('isText: binary (non-text) content is detected via NUL byte', () => {
  assert.equal(isText(Buffer.from('plain text')), true);
  assert.equal(isText(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d])), false);
});

test('lineDiff: renders a compact removed/added diff with context', () => {
  const out = lineDiff('a\nb\nc\nd', 'a\nB\nc\nd');
  assert.ok(out.some((l) => l.startsWith('  -b')));
  assert.ok(out.some((l) => l.startsWith('  +B')));
  // Unchanged lines around the change appear as context, not as -/+.
  assert.ok(out.some((l) => l === '   a'));
});

test('edits diff presentation strips CSI/OSC/BEL from human lines and JSON hunk text (R1/R4)', () => {
  // Source pin: presentation boundary (not lineDiff/diffHunks) must sanitize.
  assert.match(editsSrc, /console\.log\(`  \$\{stripControlChars\(line\)\}`\)/);
  assert.match(editsSrc, /text:\s*stripControlChars\(h\.text\)/);
  assert.match(editsSrc, /hunks:\s*diffHunks\(/);
  // lineDiff itself stays pure (no strip inside the helper).
  assert.doesNotMatch(
    editsSrc.slice(editsSrc.indexOf('export function lineDiff'), editsSrc.indexOf('// ── list')),
    /stripControlChars/,
  );

  // Pure unit: same presentation transform clears poison while leaving plain diffs intact.
  const poison = 'before\x1b[31mRED\x1b[0m\x07after';
  const rendered = lineDiff('plain\n', `plain\n${poison}\n`).map((line) => stripControlChars(line));
  for (const line of rendered) {
    assert.ok(!line.includes('\x1b'), `human line must not contain ESC: ${JSON.stringify(line)}`);
    assert.ok(!line.includes('\x07'), `human line must not contain BEL: ${JSON.stringify(line)}`);
  }
  assert.ok(rendered.some((l) => l.includes('RED') && l.includes('before') && l.includes('after')));

  const hunks = diffHunks('plain\n', `plain\n${poison}\n`).map((h) => ({
    ...h,
    text: stripControlChars(h.text),
  }));
  for (const h of hunks) {
    assert.ok(!h.text.includes('\x1b'));
    assert.ok(!h.text.includes('\x07'));
  }
  assert.equal(stripControlChars('- removed line\n+ added line'), '- removed line\n+ added line');
});

test('take / restore / keep wire to the curated core fns with resolved adapters', () => {
  assert.match(editsSrc, /takeUpstream\(customized\.slug, adapters\)/);
  assert.match(editsSrc, /restoreOriginal\(customized\.slug, adapters\)/);
  assert.match(editsSrc, /keepMine\(customized\.slug\)/);
  assert.match(editsSrc, /resolveSyncAdapters\(process\.cwd\(\)\)/);
});

test('propose 403 prints the team message with a keep hint', () => {
  assert.match(
    editsSrc,
    /You're not on this skill's team\. Keep your version with \\`skillet edits keep \$\{ref\}\\`/,
  );
  assert.match(editsSrc, /case "not_authorized":/);
});

test('propose 409 prints the moved-on message with a keep hint', () => {
  assert.match(
    editsSrc,
    /This skill has moved on upstream since your edit\. Keep yours with \\`skillet edits keep \$\{ref\}\\`/,
  );
  assert.match(editsSrc, /case "base_stale":/);
});

// ── B1/B2: propose outcome → output mapping, tested BEHAVIORALLY ─────────────
// renderProposeOutcome is the pure fn the propose action renders through; each
// core outcome must be exclusive (the old inline branches let not_authorized
// fall through into base_stale — only process.exit saved it).

const proposed: ProposeCustomizedResult = {
  status: 'proposed',
  ref: '@ada/focus-mode',
  proposalId: 'prop_123',
  proposalUrl: 'https://skillet.md/proposals/prop_123',
  hash: 'abc123',
  scan: { findings: [] },
} as unknown as ProposeCustomizedResult;
const notAuthorized: ProposeCustomizedResult = {
  status: 'not_authorized',
  ref: '@ada/focus-mode',
  message: '403',
};
const baseStale: ProposeCustomizedResult = {
  status: 'base_stale',
  ref: '@ada/focus-mode',
  message: '409',
};

test('propose outcomes are exclusive — exactly one message set per status (human mode)', () => {
  const ok = renderProposeOutcome(proposed, '@ada/focus-mode', false);
  assert.equal(ok.exitCode, ExitCode.OK);
  assert.equal(ok.stderr.length, 0);
  assert.match(ok.stdout[0]!, /Proposal submitted for @ada\/focus-mode/);

  const auth = renderProposeOutcome(notAuthorized, '@ada/focus-mode', false);
  assert.equal(auth.exitCode, ExitCode.AUTH);
  assert.equal(auth.stdout.length, 0);
  assert.equal(auth.stderr.length, 1, 'not_authorized must emit ONE message, not fall through');
  assert.match(auth.stderr[0]!, /not on this skill's team/);
  assert.match(auth.stderr[0]!, /skillet edits keep @ada\/focus-mode/);
  assert.doesNotMatch(auth.stderr[0]!, /moved on upstream/);

  const stale = renderProposeOutcome(baseStale, '@ada/focus-mode', false);
  assert.equal(stale.exitCode, ExitCode.CONFLICT);
  assert.equal(stale.stdout.length, 0);
  assert.equal(stale.stderr.length, 1);
  assert.match(stale.stderr[0]!, /moved on upstream/);
  assert.doesNotMatch(stale.stderr[0]!, /not on this skill's team/);
});

test('propose --json: all three outcomes are one stdout JSON object with exit 0 (B1 contract)', () => {
  const ok = renderProposeOutcome(proposed, '@ada/focus-mode', true);
  assert.equal(ok.exitCode, ExitCode.OK);
  assert.deepEqual(ok.stderr, []);
  assert.equal(ok.stdout.length, 1);
  assert.deepEqual(JSON.parse(ok.stdout[0]!), { status: 'proposed', proposal_id: 'prop_123' });

  const auth = renderProposeOutcome(notAuthorized, '@ada/focus-mode', true);
  assert.equal(auth.exitCode, ExitCode.OK);
  assert.deepEqual(auth.stderr, []);
  assert.deepEqual(JSON.parse(auth.stdout[0]!), { status: 'not_authorized' });

  const stale = renderProposeOutcome(baseStale, '@ada/focus-mode', true);
  assert.equal(stale.exitCode, ExitCode.OK);
  assert.deepEqual(stale.stderr, []);
  assert.deepEqual(JSON.parse(stale.stdout[0]!), { status: 'base_stale' });
});

test('propose action renders through the pure mapping and --json errors land on stdout as data', () => {
  // Wiring: the action must not re-implement the branches inline.
  assert.match(editsSrc, /renderProposeOutcome\(result,\s*ref,\s*asJson\)/);
  // Thrown failures keep nonzero-exit stderr behavior; --json adds
  // {"status":"error","message":...} on stdout before the exit.
  assert.match(editsSrc, /\{ status: "error", message: \(err as Error\)\.message \}/);
});

// ── U6/R2: tolerant, shared ref canonicalization on the local match ──────────
// resolveCustomized's local store stays @owner/slug-keyed; the MATCH runs both
// sides through @skillet/protocol/skill-id, so @a/b, a/b, and a:b all resolve
// the same customized skill instead of only the exact-typed form.

function customized(author: string, slug: string): CustomizedSkill {
  return {
    slug: `@${author}/${slug}`,
    lineage: { author, slug, version: 1, hash: 'h' },
    hasUpdate: false,
  } as unknown as CustomizedSkill;
}

test('findCustomizedByRef resolves @a/b, a/b, and a:b to the same @owner/slug-keyed entry (R2)', () => {
  const store = [customized('ada', 'focus-mode'), customized('bob', 'other')];
  const wire = findCustomizedByRef(store, '@ada/focus-mode');
  assert.ok(wire, '@ada/focus-mode must match');
  assert.equal(wire!.slug, '@ada/focus-mode');
  // The two non-@ input forms must resolve the SAME entry — the canonicalization
  // fix. Before U6 only the exact @a/b form matched.
  assert.equal(findCustomizedByRef(store, 'ada/focus-mode'), wire);
  assert.equal(findCustomizedByRef(store, 'ada:focus-mode'), wire);
});

test('findCustomizedByRef returns null for a non-existent ref — no crash, no false match', () => {
  const store = [customized('ada', 'focus-mode')];
  assert.equal(findCustomizedByRef(store, '@nope/missing'), null);
  assert.equal(findCustomizedByRef(store, 'nope/missing'), null);
  assert.equal(findCustomizedByRef(store, 'nope:missing'), null);
  // A malformed / undelimited arg must fall back cleanly and miss, never throw.
  assert.equal(findCustomizedByRef(store, 'not-a-ref'), null);
  assert.equal(findCustomizedByRef([], '@ada/focus-mode'), null);
});

test('resolveCustomized canonicalizes through the shared skill-id module (wiring)', () => {
  assert.match(editsSrc, /from "@skillet\/protocol\/skill-id"/);
  assert.match(editsSrc, /toWireRef\(ref\)/);
  assert.match(editsSrc, /findCustomizedByRef\(await listCustomized\(\)/);
});

test('edits diff, propose, and list register --json', () => {
  const program = new Command('skillet').version('test');
  registerAllCommands(program, { legacyManagement: false });
  const edits = program.commands.find((c) => c.name() === 'edits')!;
  for (const name of ['diff', 'propose', 'list']) {
    const sub = edits.commands.find((c) => c.name() === name)!;
    assert.ok(
      sub.options.some((o) => o.long === '--json'),
      `edits ${name} must accept --json`,
    );
  }
});
