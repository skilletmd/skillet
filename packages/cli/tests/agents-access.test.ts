/**
 * `skillet agents --json` carries folder-access state per runtime.
 *
 * Until this shipped, nothing outside the desktop app could answer "can
 * Skillet read this agent's skills folder" — the state existed only as a
 * transient `parked` flag on a sync envelope, so a report of "it cannot find
 * my skills" could not be diagnosed without the reporter's machine.
 *
 * The JSON keys here are a compat contract: the tray shells out to
 * `skillet runtimes --json` (src-tauri/src/lib.rs), so `access` is ADDED
 * beside the existing keys, never in place of one.
 */
import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { Command } from 'commander';

const TEST_ROOT = join(tmpdir(), `skillet-agents-access-${randomBytes(4).toString('hex')}`);
process.env['HOME'] = TEST_ROOT;
// os.homedir() reads USERPROFILE on Windows, not HOME, so seeding only HOME
// leaves the detector scanning the real profile: it finds no runtime under
// TEST_ROOT and the suite fails there and nowhere else. Same guard as
// packages/core/tests/test-env-setup.ts.
if (process.platform === 'win32') process.env['USERPROFILE'] = TEST_ROOT;
process.env['SKILLET_DIR'] = join(TEST_ROOT, '.skillet');
// TCC is macOS-only; force the policy so the assertions hold on Linux CI too.
process.env['SKILLET_TCC_POLICY'] = 'force';

const { registerRuntimesCommand } = await import('../src/commands/runtimes.js');

type AgentsJson = {
  ok: boolean;
  runtimes: Array<{
    name: string;
    label: string;
    targetDir: string;
    access?: { protected: boolean; grant: string; anchor: string | null };
  }>;
};

async function runAgents(verb: string): Promise<AgentsJson> {
  let stdout = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  // Capture STRING writes only and let everything else through untouched.
  // Under `node --test` the runner emits its own V8-serialized reporter
  // protocol (test:enqueue, test:dequeue, ...) on this same stream as binary
  // chunks; swallowing those both corrupts the capture and blinds the
  // reporter. The command under test writes a plain string.
  process.stdout.write = function (chunk: string | Uint8Array, ...rest: unknown[]): boolean {
    if (typeof chunk === 'string') {
      stdout += chunk;
      const cb = rest.find((arg) => typeof arg === 'function') as (() => void) | undefined;
      cb?.();
      return true;
    }
    return (origWrite as (...args: unknown[]) => boolean)(chunk, ...rest);
  } as typeof process.stdout.write;
  const program = new Command();
  program.exitOverride();
  registerRuntimesCommand(program);
  try {
    await program.parseAsync(['node', 'skillet', verb, '--json']);
  } finally {
    process.stdout.write = origWrite;
  }
  return JSON.parse(stdout) as AgentsJson;
}

before(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  // Two detectable runtimes so there is something to report on.
  mkdirSync(join(TEST_ROOT, '.claude', 'skills'), { recursive: true });
  mkdirSync(join(TEST_ROOT, '.agents', 'skills'), { recursive: true });
  mkdirSync(join(TEST_ROOT, '.skillet'), { recursive: true });
});

// One test, not four: the harness swaps process.stdout.write to capture the
// command's JSON, and node:test flushes its own reporter output on the same
// stream. Split across several tests, one test's runner output lands inside
// the next one's capture buffer and JSON.parse chokes on it.
test('agents --json reports folder access per runtime', async () => {
  const out = await runAgents('agents');
  const viaRuntimes = await runAgents('runtimes');

  assert.equal(out.ok, true);
  assert.ok(out.runtimes.length > 0, 'expected at least one detected runtime');

  for (const r of out.runtimes) {
    // Access is present on every row.
    assert.ok(r.access, `runtime ${r.name} is missing access`);
    assert.equal(typeof r.access.protected, 'boolean');
    assert.ok(['active', 'suspended', 'none'].includes(r.access.grant));

    // A normal dotfolder root is unprotected, unanchored, ungranted.
    assert.equal(r.access.protected, false, `${r.name} (${r.targetDir}) should be unprotected`);
    assert.equal(r.access.anchor, null);
    assert.equal(r.access.grant, 'none');

    // The compat keys the tray depends on are untouched.
    assert.equal(typeof r.name, 'string');
    assert.equal(typeof r.label, 'string');
    assert.equal(typeof r.targetDir, 'string');
  }

  // The hidden alias the desktop actually shells out to stays identical.
  assert.deepEqual(viaRuntimes, out);
});
