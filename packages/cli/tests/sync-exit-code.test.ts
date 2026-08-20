import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const syncSrc = readFileSync(join(__dirname, '../src/commands/sync.ts'), 'utf8');

test('human sync exits non-zero when union pull has failures even if some skills synced', () => {
  assert.match(
    syncSrc,
    /if \(failedCount > 0 \|\| unionFailed\.length > 0\) \{\s*\n\s*exitWith\(ExitCode\.ERROR\)/,
  );
  assert.doesNotMatch(syncSrc, /unionFailed\.length > 0 && syncedSkills === 0/);
});
