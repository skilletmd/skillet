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
import { homedir } from 'node:os';
import test from 'node:test';
import { ADAPTER_TABLE, adapterEntry } from '@skillet/protocol/adapter-table';
import { MATERIALIZATION_ROOT_ALLOWLIST, PROJECT_TARGET_ALLOWLIST } from '@skillet/core';
import { ALL_ADAPTERS, BASELINE_READER_ADAPTERS } from '../src/cli-context.js';

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
