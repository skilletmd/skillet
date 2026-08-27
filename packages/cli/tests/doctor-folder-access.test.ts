/**
 * `skillet doctor` reports macOS folder access.
 *
 * The point is a pasteable answer to "it cannot find my skills". Folder-access
 * state used to live only as a transient `parked` flag on a sync envelope
 * inside the desktop app, so that report could not be diagnosed without the
 * reporter's machine.
 *
 * Two things make the paste unambiguous: the anchor (macOS scopes consent per
 * protected folder, so the anchor is what was actually refused) and the TCC
 * identity being reported for. A grant earned under the desktop tray says
 * nothing about the terminal's, and a report that does not say which one it
 * means is worse than no report.
 */
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Command } from 'commander';

const TEST_ROOT = join(tmpdir(), `skillet-doctor-access-${randomBytes(4).toString('hex')}`);
process.env['HOME'] = TEST_ROOT;
// os.homedir() reads USERPROFILE on Windows, not HOME, so seeding only HOME
// leaves the detector scanning the real profile: it finds no runtime under
// TEST_ROOT and the suite fails there and nowhere else. Same guard as
// packages/core/tests/test-env-setup.ts.
if (process.platform === 'win32') process.env['USERPROFILE'] = TEST_ROOT;
process.env['SKILLET_DIR'] = join(TEST_ROOT, '.skillet');
// TCC is macOS-only; force the policy so this holds on Linux CI too.
process.env['SKILLET_TCC_POLICY'] = 'force';

const { registerDoctorCommand } = await import('../src/commands/doctor.js');
const { suspendTccGrant } = await import('@skillet/core');

const DOCUMENTS = join(TEST_ROOT, 'Documents');
const DECOY = join(DOCUMENTS, 'claude-skills');
const CLAUDE_SKILLS = join(TEST_ROOT, '.claude', 'skills');

type FolderAccess = {
  context: string;
  entries: Array<{
    name: string;
    target_dir: string;
    anchor: string | null;
    grant: string;
  }>;
};

async function runDoctor(args: string[]): Promise<string> {
  let stdout = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  // String writes only: `node --test` emits its V8-serialized reporter
  // protocol on this same stream as binary chunks.
  process.stdout.write = function (chunk: string | Uint8Array, ...rest: unknown[]): boolean {
    if (typeof chunk === 'string') {
      stdout += chunk;
      const cb = rest.find((arg) => typeof arg === 'function') as (() => void) | undefined;
      cb?.();
      return true;
    }
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  } as typeof process.stdout.write;
  const program = new Command();
  program.exitOverride();
  registerDoctorCommand(program);
  try {
    await program.parseAsync(['node', 'skillet', 'doctor', ...args]);
  } finally {
    process.stdout.write = origWrite;
  }
  return stdout;
}

before(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(join(TEST_ROOT, '.skillet'), { recursive: true });
  mkdirSync(DECOY, { recursive: true });
  mkdirSync(join(TEST_ROOT, '.claude'), { recursive: true });
});

after(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

test('doctor reports folder access, and stays quiet when nothing is protected', async () => {
  // No symlink yet: every adapter root is an ordinary dotfolder.
  const json = JSON.parse(await runDoctor(['--json'])) as {
    folder_access: FolderAccess;
    device: { label: string | null };
  };

  assert.ok(json.folder_access, 'doctor --json should carry folder_access');
  // A direct terminal run is the cli identity, never the desktop's.
  assert.equal(json.folder_access.context, 'cli');
  assert.deepEqual(json.folder_access.entries, [], 'no protected root, no entries');

  const human = await runDoctor([]);
  assert.ok(
    !human.includes('Folder access'),
    'the common case must gain no noise in human output',
  );
});

test('a protected root names its anchor and its denied state', async () => {
  // ~/.claude/skills becomes a symlink into ~/Documents — the real-world shape
  // (iCloud "Desktop & Documents Folders" moves a dotfolder under an anchor).
  symlinkSync(DECOY, CLAUDE_SKILLS, 'dir');
  suspendTccGrant(CLAUDE_SKILLS, 'cli', 'EPERM');

  const json = JSON.parse(await runDoctor(['--json'])) as { folder_access: FolderAccess };
  const entry = json.folder_access.entries.find((e) => e.name === 'claude-code');
  assert.ok(entry, 'the protected claude-code root should be reported');
  assert.ok(entry.anchor?.endsWith('Documents'), `anchor should be the Documents folder, got ${entry.anchor}`);
  assert.equal(entry.grant, 'suspended');

  const human = await runDoctor([]);
  assert.ok(human.includes('Folder access'), 'human output should carry the section now');
  assert.ok(human.includes('denied'), 'human output should name the denied state');
});

test('a project adapter is never reported, however the cwd resolves', async () => {
  // Project adapters carry a RELATIVE targetDir (`.cursor/rules`) under the
  // project cwd. Resolving it here describes wherever the command ran, so a
  // checkout that happens to live inside ~/Documents made doctor report every
  // project adapter as needing folder access. sync() never parks a project
  // adapter, so the row was both wrong and unactionable.
  const cwd = process.cwd();
  const inside = join(DOCUMENTS, 'some-checkout');
  mkdirSync(join(inside, '.cursor', 'rules'), { recursive: true });
  process.chdir(inside);
  try {
    const json = JSON.parse(await runDoctor(['--json'])) as { folder_access: FolderAccess };
    // isAbsolute, not a leading slash: a Windows absolute path is `C:\...`, so a
  // slash test reads every entry as relative and fails there and nowhere else.
  const relative = json.folder_access.entries.filter((e) => !isAbsolute(e.target_dir));
    assert.deepEqual(relative, [], 'no relative-path adapter root may be reported');
  } finally {
    process.chdir(cwd);
  }
});

test('the report carries no device label', async () => {
  const json = JSON.parse(await runDoctor(['--json'])) as { device: { label: string | null } };
  // Machine identity never leaves the machine (see CLAUDE.md).
  assert.equal(json.device.label, null);
});
