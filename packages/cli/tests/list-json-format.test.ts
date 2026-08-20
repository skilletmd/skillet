import assert from 'node:assert/strict';
import test from 'node:test';
import type { SkillEntry } from '@skillet/core';
import { toListJsonSkill } from '../src/list-json-format.js';

function skill(overrides: Partial<SkillEntry> = {}): SkillEntry {
  const now = '2026-06-25T00:00:00Z';
  return {
    slug: '@me/alpha',
    name: 'alpha',
    description: 'desc',
    version: 1,
    hash: 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456',
    source: 'registry',
    importedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

test('toListJsonSkill emits the label string when versionLabel is present', () => {
  const out = toListJsonSkill(skill({ versionLabel: '2.1.0' }), { local: true, body: '# alpha' });
  assert.equal(out.versionLabel, '2.1.0');
});

test('toListJsonSkill emits null when versionLabel is absent', () => {
  const out = toListJsonSkill(skill(), { local: true, body: '# alpha' });
  assert.equal(out.versionLabel, null);
});

test('toListJsonSkill carries token fields when present', () => {
  const out = toListJsonSkill(
    skill({ tokenCount: 1320, tokenAmbient: 90, tokenMethod: 'heuristic-v1' }),
    { local: true, body: '# alpha' },
  );
  assert.equal(out.token_count, 1320);
  assert.equal(out.token_ambient, 90);
  assert.equal(out.token_method, 'heuristic-v1');
});

test('toListJsonSkill omits token keys when the entry has none', () => {
  const out = toListJsonSkill(skill(), { local: true, body: '# alpha' });
  assert.equal('token_count' in out, false);
  assert.equal('token_ambient' in out, false);
  assert.equal('token_method' in out, false);
});
