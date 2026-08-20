import { describe, it, expect } from 'vitest';
import {
  groupSkillsByKit,
  isSkilletSystemSkill,
  isKitSyncedSkill,
  kitSyncedState,
} from '../src/kit/sync-scope.js';
import { BUNDLED_ROUTE_SLUG } from '../src/commands/route.js';
import type { KitState, SkillEntry } from '../src/kit/types.js';
import type { SyncManifestItem } from '@skillet/protocol';

function entry(slug: string, overrides: Partial<SkillEntry> = {}): SkillEntry {
  const now = new Date().toISOString();
  return {
    slug,
    name: slug,
    description: '',
    version: 1,
    hash: 'sha256:abc',
    source: 'local',
    sourceKit: null,
    importedAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function manifestItem(
  ref: string,
  sourceKit: string,
  hash = 'sha256:abc',
): SyncManifestItem {
  return {
    ref,
    version: 1,
    content_hash: hash,
    signature: null,
    author_key_id: null,
    policy: 'manual',
    source_kit: sourceKit,
    external_author: false,
  };
}

describe('sync-scope', () => {
  it('isKitSyncedSkill requires a non-empty sourceKit', () => {
    expect(isKitSyncedSkill(entry('a'))).toBe(false);
    expect(isKitSyncedSkill(entry('b', { sourceKit: '' }))).toBe(false);
    expect(isKitSyncedSkill(entry('c', { sourceKit: '@alice/kit' }))).toBe(true);
  });

  it('isSkilletSystemSkill matches the bundled router', () => {
    expect(
      isSkilletSystemSkill(
        entry(BUNDLED_ROUTE_SLUG, { source: 'local', owner: 'skillet' }),
      ),
    ).toBe(true);
    expect(isSkilletSystemSkill(entry('local-only'))).toBe(false);
  });

  it('groupSkillsByKit separates kit skills from local-only imports', () => {
    const state: KitState = {
      version: 1,
      skills: {
        local: entry('local-only'),
        a: entry('@alice/skill-a', { sourceKit: '@alice/kit' }),
        b: entry('@alice/skill-b', { sourceKit: '@alice/kit' }),
        c: entry('@bob/skill', { sourceKit: '@bob/other' }),
      },
    };
    const groups = groupSkillsByKit(state);
    expect(groups).toHaveLength(3);
    expect(groups[0]?.kitRef).toBe('@alice/kit');
    expect(groups[0]?.skills).toHaveLength(2);
    expect(groups[1]?.kitRef).toBe('@bob/other');
    expect(groups[2]?.kitRef).toBeNull();
    expect(groups[2]?.skills.map((s) => s.slug)).toEqual(['local-only']);
  });

  it('groupSkillsByKit lists registry manifest skills when local store is empty', () => {
    const items = [
      manifestItem('@thiago/skillet-sync', '@thiago/profile', 'sha256:abc'),
      manifestItem('@thiago/write-a-skill', '@thiago/partner-kit', 'sha256:def'),
    ];
    const groups = groupSkillsByKit({ version: 1, skills: {} }, { manifestItems: items });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.kitRef).toBe('@thiago/partner-kit');
    expect(groups[0]?.skills.map((s) => s.slug)).toEqual(['@thiago/write-a-skill']);
    expect(groups[1]?.kitRef).toBe('@thiago/profile');
    expect(groups[1]?.skills.map((s) => s.slug)).toEqual(['@thiago/skillet-sync']);
  });

  it('groupSkillsByKit uses manifest kit membership over local import aliases', () => {
    const hash = 'sha256:5a8c08c83de1';
    const state: KitState = {
      version: 1,
      skills: {
        'skillet-sync': entry('skillet-sync', { hash, name: 'skillet-sync' }),
        '@thiago/skillet-sync': entry('@thiago/skillet-sync', { hash }),
        'good-import': entry('good-import', { hash: 'sha256:other' }),
      },
    };
    const items = [
      manifestItem('@thiago/skillet-sync', '@thiago/partner-kit', hash),
    ];
    const groups = groupSkillsByKit(state, { manifestItems: items });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.kitRef).toBe('@thiago/partner-kit');
    expect(groups[0]?.skills.map((s) => s.slug)).toEqual(['@thiago/skillet-sync']);
    expect(groups[1]?.kitRef).toBeNull();
    expect(groups[1]?.skills.map((s) => s.slug)).toEqual(['good-import']);
  });

  it('groupSkillsByKit omits excluded kit skills when manifest is authoritative', () => {
    const state: KitState = {
      version: 1,
      skills: {
        kept: entry('@thiago/cli-skill', {
          source: 'registry',
          sourceKit: '@thiago/cli-kit',
        }),
        dropped: entry('@skillet/commit-message', {
          source: 'registry',
          sourceKit: '@thiago/partner-kit',
        }),
        local: entry('local-only'),
      },
    };
    const items = [manifestItem('@thiago/cli-skill', '@thiago/cli-kit')];
    const groups = groupSkillsByKit(state, { manifestItems: items });
    expect(groups).toHaveLength(2);
    expect(groups[0]?.kitRef).toBe('@thiago/cli-kit');
    expect(groups[0]?.skills.map((s) => s.slug)).toEqual(['@thiago/cli-skill']);
    expect(groups[1]?.kitRef).toBeNull();
    expect(groups[1]?.skills.map((s) => s.slug)).toEqual(['local-only']);
  });

  it('groupSkillsByKit treats an empty manifest as authoritative (no kit groups)', () => {
    const state: KitState = {
      version: 1,
      skills: {
        synced: entry('@thiago/skill', {
          source: 'registry',
          sourceKit: '@thiago/partner-kit',
        }),
        local: entry('local-only'),
      },
    };
    const groups = groupSkillsByKit(state, { manifestItems: [] });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kitRef).toBeNull();
    expect(groups[0]?.skills.map((s) => s.slug)).toEqual(['local-only']);
  });

  it('groupSkillsByKit falls back to local sourceKit when manifest is unavailable', () => {
    const state: KitState = {
      version: 1,
      skills: {
        synced: entry('@thiago/skill', { sourceKit: '@thiago/partner-kit' }),
      },
    };
    const groups = groupSkillsByKit(state);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.kitRef).toBe('@thiago/partner-kit');
  });

  it('kitSyncedState filters to kit members only', () => {
    const state: KitState = {
      version: 1,
      skills: {
        local: entry('local-only'),
        synced: entry('synced', { sourceKit: '@alice/kit' }),
      },
    };
    const sliced = kitSyncedState(state);
    expect(Object.keys(sliced.skills)).toEqual(['synced']);
  });
});
