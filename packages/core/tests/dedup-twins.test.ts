import { describe, expect, it } from 'vitest';
import { collapsePublishedTwins } from '../src/kit/dedup-twins.js';
import type { KitState, SkillEntry } from '../src/kit/types.js';

function entry(over: Partial<SkillEntry> & { slug: string }): SkillEntry {
  return {
    name: over.slug,
    description: '',
    version: 1,
    hash: 'sha256:aaaa',
    source: 'local',
    ...over,
  } as SkillEntry;
}

function state(skills: Record<string, SkillEntry>): KitState {
  return { version: 1, skills } as KitState;
}

describe('collapsePublishedTwins', () => {
  it('removes a bare twin when an owned same-hash promoted entry exists', () => {
    const s = state({
      'bob-edited': entry({ slug: 'bob-edited', source: 'registry', hash: 'sha256:h1' }),
      '@taylor/bob-edited': entry({
        slug: '@taylor/bob-edited',
        owner: 'taylor',
        source: 'registry',
        hash: 'sha256:h1',
      }),
    });
    const { removed } = collapsePublishedTwins(s);
    expect(removed).toEqual(['bob-edited']);
    expect(Object.keys(s.skills)).toEqual(['@taylor/bob-edited']);
  });

  it('collapses a source:local bare twin too (it inflates the capturable list)', () => {
    const s = state({
      drop: entry({ slug: 'drop', source: 'local', hash: 'sha256:h2' }),
      '@taylor/drop': entry({
        slug: '@taylor/drop',
        owner: 'taylor',
        source: 'registry',
        hash: 'sha256:h2',
      }),
    });
    const { removed } = collapsePublishedTwins(s);
    expect(removed).toEqual(['drop']);
    expect(s.skills.drop).toBeUndefined();
  });

  it('keeps a genuine local-only skill with no promoted twin', () => {
    const s = state({
      cloudflare: entry({ slug: 'cloudflare', source: 'local', hash: 'sha256:h3' }),
    });
    const { removed } = collapsePublishedTwins(s);
    expect(removed).toEqual([]);
    expect(s.skills.cloudflare).toBeDefined();
  });

  it('keeps a diverged local edit (different hash) — never discards a fork', () => {
    const s = state({
      forked: entry({ slug: 'forked', source: 'local', hash: 'sha256:LOCAL' }),
      '@taylor/forked': entry({
        slug: '@taylor/forked',
        owner: 'taylor',
        source: 'registry',
        hash: 'sha256:REMOTE',
      }),
    });
    const { removed } = collapsePublishedTwins(s);
    expect(removed).toEqual([]);
    expect(s.skills.forked).toBeDefined();
  });

  it('keeps pinned / customized / held-update twins (they carry user intent)', () => {
    const s = state({
      pinnedTwin: entry({ slug: 'pinnedTwin', hash: 'sha256:hp', pinned: true }),
      '@taylor/pinnedTwin': entry({
        slug: '@taylor/pinnedTwin',
        owner: 'taylor',
        hash: 'sha256:hp',
      }),
      customizedTwin: entry({
        slug: 'customizedTwin',
        hash: 'sha256:hc',
        customized_from: { author: 'taylor', slug: 'customizedTwin', version: 1, hash: 'sha256:hc' },
      }),
      '@taylor/customizedTwin': entry({
        slug: '@taylor/customizedTwin',
        owner: 'taylor',
        hash: 'sha256:hc',
      }),
    });
    const { removed } = collapsePublishedTwins(s);
    expect(removed).toEqual([]);
    expect(s.skills.pinnedTwin).toBeDefined();
    expect(s.skills.customizedTwin).toBeDefined();
  });

  it('does not treat an owned bare entry as a leftover', () => {
    const s = state({
      owned: entry({ slug: 'owned', owner: 'taylor', hash: 'sha256:h4' }),
      '@taylor/owned': entry({ slug: '@taylor/owned', owner: 'taylor', hash: 'sha256:h4' }),
    });
    const { removed } = collapsePublishedTwins(s);
    expect(removed).toEqual([]);
    expect(s.skills.owned).toBeDefined();
  });
});
