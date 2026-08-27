// Parity between the canonical adapter table (@skillet/protocol) and the
// adapters this CLI actually ships.
//
// The table is what the registry serves as the signed
// `/api/v1/adapters/manifest`, telling clients where each runtime keeps its
// skills. Nothing consumes that manifest yet, which is precisely why it rotted
// unnoticed: the June 2026 Windsurf → Devin Desktop rebrand moved that runtime
// from a project-scoped `.windsurf/rules` writer to a global
// `~/.codeium/windsurf/skills` materializer, and the table kept serving the
// dead path. Every display label in the repo was updated; the wire table was
// not, because no test compared it to reality.
//
// This is that test. The CLI is the only package that depends on both the
// table and all eight adapter packages, so it is the only place the comparison
// can be made.

import assert from 'node:assert/strict';
import { homedir, platform } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';
import { ADAPTER_TABLE, adapterEntry } from '@skillet/protocol/adapter-table';
import { MATERIALIZATION_ROOT_ALLOWLIST, PROJECT_TARGET_ALLOWLIST } from '@skillet/core';
import { ALL_ADAPTERS, BASELINE_READER_ADAPTERS } from '../src/cli-context.js';

const IS_WINDOWS = platform() === 'win32';

/**
 * Runtimes whose root is platform-conditional, and the POSIX root the table
 * carries for them.
 *
 * `AdapterEntry.root` is tilde-form by contract, and the client verifier only
 * expands a leading `~/`. Hermes reads `%LOCALAPPDATA%\hermes\skills` and
 * Devin CLI `%APPDATA%\devin\skills` on native Windows — env-var roots that
 * the wire format has no way to express, and that need not sit under the
 * homedir at all. So on win32 the table's root CANNOT equal the adapter's
 * resolved `targetDir` for these two, and asserting it did is what made this
 * suite red on the Windows job while every POSIX job stayed green.
 *
 * The drift check still runs there, against the value the platform actually
 * resolves: the table must carry the POSIX sibling, and the adapter must land
 * inside core's own Windows allowlist (which builds the LOCALAPPDATA/APPDATA
 * entries from the same env vars the adapters read). Neither side can rot
 * unnoticed; they are just checked against different sources of truth.
 */
const WINDOWS_DIVERGENT: Record<string, string> = {
  hermes: '~/.hermes/skills',
  devin: '~/.config/devin/skills',
};

/** Adapter `targetDir` is absolute and host-specific; the table is tilde-form. */
function toTildeForm(abs: string): string {
  const home = homedir();
  const posix = abs.split('\\').join('/');
  const homePosix = home.split('\\').join('/');
  return posix.startsWith(homePosix) ? `~${posix.slice(homePosix.length)}` : posix;
}

test('every shipped adapter has a table entry', () => {
  for (const adapter of ALL_ADAPTERS) {
    assert.ok(
      adapterEntry(adapter.name),
      `adapter "${adapter.name}" ships but has no entry in ADAPTER_TABLE — ` +
        `clients would never learn where it materializes`,
    );
  }
});

test('every table entry corresponds to a shipped adapter', () => {
  const shipped = new Set(ALL_ADAPTERS.map((a) => a.name));
  for (const entry of ADAPTER_TABLE) {
    assert.ok(
      shipped.has(entry.key),
      `ADAPTER_TABLE advertises "${entry.key}", which no shipped adapter writes`,
    );
  }
});

test('table root matches each adapter targetDir', () => {
  for (const adapter of ALL_ADAPTERS) {
    const entry = adapterEntry(adapter.name);
    if (!entry) continue; // covered by the test above

    const posixRoot = WINDOWS_DIVERGENT[adapter.name];
    if (IS_WINDOWS && posixRoot !== undefined) {
      assert.equal(
        entry.root,
        posixRoot,
        `table root for "${adapter.name}" drifted from its POSIX root ${posixRoot}`,
      );
      const target = resolve(adapter.targetDir);
      assert.ok(
        MATERIALIZATION_ROOT_ALLOWLIST.some((a) => resolve(a) === target),
        `adapter "${adapter.name}" writes to ${adapter.targetDir} on Windows, ` +
          `which is not in MATERIALIZATION_ROOT_ALLOWLIST — materialization would be rejected`,
      );
      continue;
    }

    const actual = entry.kind === 'project' ? adapter.targetDir : toTildeForm(adapter.targetDir);
    assert.equal(
      actual,
      entry.root,
      `adapter "${adapter.name}" writes to ${actual}, table says ${entry.root}`,
    );
  }
});

test('table kind matches each adapter kind', () => {
  for (const adapter of ALL_ADAPTERS) {
    const entry = adapterEntry(adapter.name);
    if (!entry) continue;
    // Adapter.kind defaults to "global" when omitted.
    assert.equal(
      adapter.kind ?? 'global',
      entry.kind,
      `adapter "${adapter.name}" is ${adapter.kind ?? 'global'}, table says ${entry.kind}`,
    );
  }
});

test('every table root is allowlisted', () => {
  // The client-side verifier checks a manifest root against these lists. A
  // table entry the allowlist rejects would be silently dropped on the degrade
  // path — the runtime would vanish from the manifest with no error.
  for (const entry of ADAPTER_TABLE) {
    if (entry.kind === 'project') {
      assert.ok(
        PROJECT_TARGET_ALLOWLIST.includes(entry.root),
        `project root "${entry.root}" (${entry.key}) is not in PROJECT_TARGET_ALLOWLIST`,
      );
    } else {
      const allowed = MATERIALIZATION_ROOT_ALLOWLIST.map(toTildeForm);
      assert.ok(
        allowed.includes(entry.root),
        `global root "${entry.root}" (${entry.key}) is not in MATERIALIZATION_ROOT_ALLOWLIST`,
      );
    }
  }
});

test('baseline readers stay out of the table', () => {
  // opencode reads the universal ~/.agents/skills baseline that the codex
  // entry already writes. Listing it would describe a materialization that
  // never happens and double-count one write.
  for (const adapter of BASELINE_READER_ADAPTERS) {
    assert.equal(
      adapterEntry(adapter.name),
      undefined,
      `baseline reader "${adapter.name}" must not claim a materialization root`,
    );
  }
});

test('windsurf is a global skills folder, not the retired rules dir', () => {
  // Regression pin for the rebrand drift this test was written for.
  const entry = adapterEntry('windsurf');
  assert.ok(entry);
  assert.equal(entry.kind, 'global');
  assert.equal(entry.layout, 'skill-md');
  assert.equal(entry.root, '~/.codeium/windsurf/skills');
});
