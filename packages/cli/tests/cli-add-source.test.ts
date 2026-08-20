import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isRegistrySkillRef,
  normalizeRegistryRef,
  resolveAddSource,
} from '../src/cli-add-source.js';
import { configureAddPresent, printAddBanner, printStepInfo } from '../src/cli-add-present.js';
import { formatAdapterList } from '../src/cli-add-adapters.js';

test('normalizeRegistryRef requires @ prefix', () => {
  assert.equal(normalizeRegistryRef('@alice/my-skill'), '@alice/my-skill');
});

test('isRegistrySkillRef accepts @author/slug only', () => {
  assert.equal(isRegistrySkillRef('@alice/my-skill'), true);
  assert.equal(isRegistrySkillRef('vercel-labs/skills'), false);
});

test('resolveAddSource classifies github shorthand', async () => {
  const src = await resolveAddSource('vercel-labs/skills');
  assert.equal(src.kind, 'github');
  assert.equal(src.githubRef, 'vercel-labs/skills');
});

test('resolveAddSource classifies registry ref', async () => {
  const src = await resolveAddSource('@alice/commit-message');
  assert.equal(src.kind, 'registry_skill');
  assert.equal(src.registryRef, '@alice/commit-message');
});

test('resolveAddSource rejects owner/repo as registry', async () => {
  const src = await resolveAddSource('alice/commit-message');
  assert.equal(src.kind, 'github');
});

test('presentation helpers run without color', () => {
  configureAddPresent({ json: true, color: false });
  printAddBanner();
  printStepInfo('Source: https://github.com/o/r');
});

test('formatAdapterList handles empty', () => {
  assert.equal(formatAdapterList([]), 'Universal only');
});
