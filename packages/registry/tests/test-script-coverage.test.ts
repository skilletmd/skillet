// Every test file in this directory has to be named in the `test` script.
//
// The registry's runner is an explicit list, not a glob: the MySQL suites share
// one database and have to run in a fixed order at concurrency 1, which a glob
// cannot express. The cost of that is silent — a new `tests/*.test.ts` file is
// simply never run, and CI reports green for a suite it did not execute. Five
// files shipped that way with the summon-suggestions work (clustering, payload
// shaping, copy-event validation, CLI phrasing, and the backfill itself): all
// passing, none of them running anywhere but a developer's terminal.
//
// This is the guard. Add the file to the list when you add the file.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testsDir = dirname(fileURLToPath(import.meta.url));
const pkgPath = join(testsDir, '..', 'package.json');

describe('test script coverage', () => {
  it('names every tests/*.test.ts file in the test script', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    const listed = new Set(pkg.scripts['test']?.match(/tests\/[\w.-]+\.test\.ts/g) ?? []);
    const onDisk = readdirSync(testsDir)
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => `tests/${f}`);

    const unlisted = onDisk.filter((f) => !listed.has(f));
    assert.deepEqual(
      unlisted,
      [],
      `these test files never run in CI — add them to the "test" script in ` +
        `packages/registry/package.json:\n  ${unlisted.join('\n  ')}`,
    );
  });

  it('names no test script entry that no longer exists', () => {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    const listed = pkg.scripts['test']?.match(/tests\/[\w.-]+\.test\.ts/g) ?? [];
    const onDisk = new Set(
      readdirSync(testsDir)
        .filter((f) => f.endsWith('.test.ts'))
        .map((f) => `tests/${f}`),
    );

    // A renamed file left behind in the list fails the whole run at startup,
    // which is loud — but a DELETED one does too, and the message is a bare
    // ENOENT with no hint that package.json is where to look.
    const missing = listed.filter((f) => !onDisk.has(f));
    assert.deepEqual(missing, [], `listed but not on disk: ${missing.join(', ')}`);
  });
});
