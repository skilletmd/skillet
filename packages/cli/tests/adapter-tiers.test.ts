import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  baselineAdaptersForCwd,
  isBaselineAdapterName,
  resolveMaterializeAdapters,
} from '../src/adapter-tiers.js';

test('isBaselineAdapterName recognizes universal adapters', () => {
  assert.equal(isBaselineAdapterName('codex'), true);
  assert.equal(isBaselineAdapterName('codex-project'), true);
  assert.equal(isBaselineAdapterName('cursor'), false);
});

test('baselineAdaptersForCwd returns global codex outside a repo', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'skillet-tier-'));
  try {
    const baseline = await baselineAdaptersForCwd(cwd);
    assert.equal(baseline.length, 1);
    assert.equal(baseline[0]!.name, 'codex');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('baselineAdaptersForCwd includes codex-project inside a git repo', async () => {
  const repo = await mkdtemp(join(tmpdir(), 'skillet-tier-repo-'));
  try {
    await mkdir(join(repo, '.git'), { recursive: true });
    const baseline = await baselineAdaptersForCwd(repo);
    assert.equal(baseline.length, 2);
    assert.deepEqual(
      baseline.map((a) => a.name),
      ['codex', 'codex-project'],
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test('resolveMaterializeAdapters with no additional returns baseline only', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'skillet-tier-res-'));
  try {
    const { adapters, baselineNames } = await resolveMaterializeAdapters(cwd, []);
    assert.equal(adapters.length, 1);
    assert.deepEqual(baselineNames, ['codex']);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('resolveMaterializeAdapters skips duplicate baseline in additional picks', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'skillet-tier-dedup-'));
  try {
    const codex = (await baselineAdaptersForCwd(cwd))[0]!;
    const { adapters } = await resolveMaterializeAdapters(cwd, [codex]);
    assert.equal(adapters.length, 1);
    assert.equal(adapters[0]!.name, 'codex');
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('baselineAdaptersForCwd excludes project when cwd resolves to homedir global path', async () => {
  const agentsHome = join(homedir(), '.agents');
  const baseline = await baselineAdaptersForCwd(agentsHome);
  assert.equal(baseline.length, 1);
  assert.equal(baseline[0]!.name, 'codex');
});
