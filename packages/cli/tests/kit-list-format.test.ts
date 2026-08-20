import assert from 'node:assert/strict';
import test from 'node:test';
import type { KitSkillGroup } from '@skillet/core';
import { renderKitList, renderSyncKitPlan } from '../src/kit-list-format.js';
import {
  buildSyncKitsJson,
  kitGroupsForDevice,
  skipReasonsFromSyncResult,
} from '../src/sync-kit-plan.js';

function skill(slug: string, sourceKit: string | null = '@me/kit-a') {
  const now = '2026-06-25T00:00:00Z';
  return {
    slug,
    name: slug.split('/').pop() ?? slug,
    description: 'desc',
    version: 1,
    hash: 'sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456',
    source: 'registry' as const,
    sourceKit,
    importedAt: now,
    updatedAt: now,
  };
}

const twoKitGroups: KitSkillGroup[] = [
  { kitRef: '@me/kit-a', skills: [skill('@me/alpha'), skill('@me/beta')] },
  { kitRef: '@me/kit-b', skills: [skill('@me/gamma', '@me/kit-b')] },
];

test('renderSyncKitPlan lists kit groups with skill rows', () => {
  const out = renderSyncKitPlan(twoKitGroups);
  assert.match(out, /Kits on this device/);
  assert.match(out, /@me\/kit-a/);
  assert.match(out, /@me\/alpha/);
  assert.match(out, /@me\/kit-b/);
  assert.match(out, /@me\/gamma/);
});

test('renderSyncKitPlan annotates skipped skills', () => {
  const reasons = new Map([['@me/beta', 'integrity_failed: missing author key']]);
  const out = renderSyncKitPlan(twoKitGroups, { skipReasons: reasons });
  assert.match(out, /skipped: missing author key/);
});

test('skill rows prefer versionLabel and fall back to the integer version', () => {
  const groups: KitSkillGroup[] = [
    {
      kitRef: '@me/kit-a',
      skills: [
        { ...skill('@me/alpha'), version: 2, versionLabel: '2.1.0' },
        { ...skill('@me/beta'), version: 3 },
      ],
    },
  ];
  const out = renderKitList(groups);
  assert.match(out, /v2\.1\.0/);
  assert.match(out, /v3\b/);
  assert.doesNotMatch(out, /v2 /);
});

test('token stat renders after the version and before a trailing status', () => {
  const groups: KitSkillGroup[] = [
    {
      kitRef: '@me/kit-a',
      skills: [{ ...skill('@me/alpha'), version: 2, versionLabel: '2.1.0', tokenCount: 1320 }],
    },
  ];
  const out = renderKitList(groups, { awaitingConsent: new Set(['@me/alpha']) });
  assert.match(out, /~1\.3K/);
  const verIdx = out.indexOf('v2.1.0');
  const tokenIdx = out.indexOf('~1.3K');
  const statusIdx = out.indexOf('waiting for your OK');
  assert.ok(verIdx < tokenIdx, 'version precedes token stat');
  assert.ok(tokenIdx < statusIdx, 'token stat precedes trailing status');
});

test('token stat precedes the skipped suffix in the sync plan', () => {
  const groups: KitSkillGroup[] = [
    { kitRef: '@me/kit-a', skills: [{ ...skill('@me/alpha'), tokenCount: 47000 }] },
  ];
  const out = renderSyncKitPlan(groups, {
    skipReasons: new Map([['@me/alpha', 'integrity_failed: bad key']]),
  });
  const tokenIdx = out.indexOf('~47K');
  const skipIdx = out.indexOf('skipped:');
  assert.ok(tokenIdx >= 0 && skipIdx >= 0);
  assert.ok(tokenIdx < skipIdx, 'token stat precedes the skipped suffix');
});

test('rows render no token stat when the count is absent or zero', () => {
  const absent = renderKitList([{ kitRef: '@me/kit-a', skills: [skill('@me/alpha')] }]);
  assert.doesNotMatch(absent, /~/);
  const zero = renderKitList([
    { kitRef: '@me/kit-a', skills: [{ ...skill('@me/alpha'), tokenCount: 0 }] },
  ]);
  assert.doesNotMatch(zero, /~/);
});

test('buildSyncKitsJson carries token fields per skill', () => {
  const groups: KitSkillGroup[] = [
    {
      kitRef: '@me/kit-a',
      skills: [{ ...skill('@me/alpha'), tokenCount: 1320, tokenAmbient: 90, tokenMethod: 'heuristic-v1' }],
    },
  ];
  const kits = buildSyncKitsJson(groups, new Map(), 'synced');
  const s = kits[0]?.skills[0];
  assert.equal(s?.token_count, 1320);
  assert.equal(s?.token_ambient, 90);
  assert.equal(s?.token_method, 'heuristic-v1');
});

test('renderSyncKitPlan handles empty kit groups', () => {
  const out = renderSyncKitPlan([{ kitRef: null, skills: [skill('local', null)] }]);
  assert.match(out, /No kit skills on this device/);
});

test('buildSyncKitsJson marks skipped and synced skills', () => {
  const reasons = new Map([['@me/beta', 'integrity_failed']]);
  const kits = buildSyncKitsJson(twoKitGroups, reasons, 'synced');
  assert.equal(kits.length, 2);
  assert.deepEqual(kits[0]?.skills.find((s) => s.slug === '@me/beta'), {
    slug: '@me/beta',
    status: 'skipped',
    reason: 'integrity_failed',
  });
  assert.equal(kits[0]?.skills.find((s) => s.slug === '@me/alpha')?.status, 'synced');
});

test('skipReasonsFromSyncResult merges failed and union pull failures', () => {
  const map = skipReasonsFromSyncResult({
    failed: [{ slug: '@me/a', reason: 'integrity_failed' }],
    unionPull: [{ slug: '@me/b', status: 'failed', reason: 'network' }],
  });
  assert.equal(map.get('@me/a'), 'integrity_failed');
  assert.equal(map.get('@me/b'), 'network');
});

test('kitGroupsForDevice filters to kit groups only', () => {
  const state = {
    version: 1 as const,
    skills: {
      '@me/alpha': skill('@me/alpha'),
      'local-only': skill('local-only', null),
    },
  };
  const groups = kitGroupsForDevice(state, undefined);
  assert.equal(groups.length, 1);
  assert.equal(groups[0]?.kitRef, '@me/kit-a');
});
