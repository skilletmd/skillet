import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const syncSrc = readFileSync(join(__dirname, '../src/commands/sync.ts'), 'utf8');
const dryRunSrc = readFileSync(join(__dirname, '../src/dry-run.ts'), 'utf8');

test('sync passes quietSkipLines for human output only', () => {
  assert.match(syncSrc, /quietSkipLines:\s*!asJson/);
});

test('sync prints grouped kit plan before adapters block', () => {
  const kitPlanIdx = syncSrc.indexOf('renderSyncKitPlan(kitGroups');
  const adaptersIdx = syncSrc.indexOf("console.log('Agents:')");
  assert.ok(kitPlanIdx >= 0 && adaptersIdx >= 0);
  assert.ok(kitPlanIdx < adaptersIdx, 'kit plan should render before Adapters');
});

test('sync --json includes kits array in payload', () => {
  assert.match(syncSrc, /kits:\s*kitsJson/);
  assert.match(syncSrc, /buildSyncKitsJson\(kitGroups,\s*skipReasons,\s*'synced'\)/);
});

test('sync dry-run human path uses grouped kit plan', () => {
  assert.match(syncSrc, /Kits on this device \(dry run\)/);
  assert.match(syncSrc, /renderSyncKitPlan\(groups/);
});

test('sync dry-run JSON plan includes kits', () => {
  assert.match(syncSrc, /buildSyncKitsJson\(groups,\s*new Map\(\),\s*'planned'\)/);
  assert.match(dryRunSrc, /kits:\s*SyncKitGroupJson\[\]/);
});

test('sync --json threads structured error codes into the envelope', () => {
  // The desktop tray classifies `code: 'machine_disconnected'` (device revoked on
  // the web) — the catch must pass the thrown RegistryError's code to
  // writeJsonError, narrowed so incidental `.code` fields never leak in.
  assert.match(syncSrc, /const code = err instanceof RegistryError \? err\.code : undefined/);
  assert.match(syncSrc, /writeJsonError\(\(err as Error\)\.message, \{ \.\.\.\(code \? \{ code \} : \{\}\), exitCode: exit \}\)/);
});

test('sync routes an auth-rejection (401/403 RegistryError) to AUTH exit, not ERROR', () => {
  // A revoked device / stale session is an auth failure — exit AUTH so scripts
  // and the tray prompt a re-pair instead of treating it as a retryable error.
  assert.match(
    syncSrc,
    /err instanceof RegistryError && \(err\.status === 401 \|\| err\.status === 403\)/,
  );
  assert.match(syncSrc, /const exit = authRejected \? ExitCode\.AUTH : ExitCode\.ERROR/);
});

test('sync --json envelope carries customized + localized, not the old capture fields (U5)', () => {
  assert.match(syncSrc, /customized:\s*result\.customized/);
  assert.match(syncSrc, /localized:\s*result\.localized/);
  // The #388 capture/pause/escalation/fork/kept fields are gone from the envelope.
  assert.doesNotMatch(syncSrc, /capturedEdits/);
  assert.doesNotMatch(syncSrc, /captureEscalations/);
  assert.doesNotMatch(syncSrc, /pausedOrphans/);
  assert.doesNotMatch(syncSrc, /forkedEdited/);
  assert.doesNotMatch(syncSrc, /keptEdited/);
});

test('sync human output prints one quiet line per customized-with-update skill', () => {
  const idx = syncSrc.indexOf('for (const c of result.customized)');
  assert.ok(idx >= 0, 'expected a customized loop in human output');
  const loopSrc = syncSrc.slice(idx, idx + 400);
  // Only the ones with a held update surface, and each points at `skillet edits`.
  assert.match(loopSrc, /if \(!c\.hasUpdate\) continue/);
  assert.match(loopSrc, /Reconcile with \\`skillet edits\\`/);
});

test('sync human output prints one quiet line per localized skill (P2 fix — was --json only)', () => {
  const idx = syncSrc.indexOf('for (const l of result.localized)');
  assert.ok(idx >= 0, 'expected a localized loop in human output');
  const loopSrc = syncSrc.slice(idx, idx + 200);
  assert.match(loopSrc, /Kept "\$\{l\.slug\}" as your own local skill \(unsubscribed\)/);
});

test('no stale capture/pause/escalation copy remains in sync human output (U5)', () => {
  assert.doesNotMatch(syncSrc, /Kept a changed copy/);
  assert.doesNotMatch(syncSrc, /skillet edits unpause/);
  assert.doesNotMatch(syncSrc, /skillet edits list/);
  assert.doesNotMatch(syncSrc, /!! /);
});
