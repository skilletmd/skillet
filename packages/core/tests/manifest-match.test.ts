import { describe, it, expect } from 'vitest';
import {
  alignEntryToManifest,
  findLocalForManifestItem,
  localMatchesManifest,
  sanitizeVersionLabel,
} from '../src/kit/manifest-match.js';
import type { KitState, SkillEntry } from '../src/kit/types.js';
import type { SyncManifestItem } from '@skillet/protocol';

function entry(slug: string, hash: string): SkillEntry {
  const now = new Date().toISOString();
  return {
    slug,
    name: slug,
    description: '',
    version: 1,
    hash,
    source: 'local',
    importedAt: now,
    updatedAt: now,
  };
}

const item: SyncManifestItem = {
  ref: '@thiago/skillet-sync',
  version: 1,
  content_hash: 'sha256:5a8c08c83de1',
  signature: null,
  author_key_id: null,
  policy: 'manual',
  source_kit: '@thiago/partner-kit',
  external_author: false,
};

describe('manifest-match', () => {
  it('matches import aliases by hash and short slug', () => {
    expect(localMatchesManifest(entry('skillet-sync', item.content_hash), item)).toBe(true);
    expect(localMatchesManifest(entry('other', 'sha256:zzz'), item)).toBe(false);
  });

  it('matches a local slug across @owner/slug, owner/slug, and owner:slug forms', () => {
    expect(localMatchesManifest(entry('@thiago/skillet-sync', 'sha256:zzz'), item)).toBe(true);
    expect(localMatchesManifest(entry('thiago/skillet-sync', 'sha256:zzz'), item)).toBe(true);
    expect(localMatchesManifest(entry('thiago:skillet-sync', 'sha256:zzz'), item)).toBe(true);
  });

  it('does not over-match a different owner or slug', () => {
    expect(localMatchesManifest(entry('someoneelse/skillet-sync', 'sha256:zzz'), item)).toBe(false);
    expect(localMatchesManifest(entry('thiago/other-skill', 'sha256:zzz'), item)).toBe(false);
    expect(localMatchesManifest(entry('thiago:other-skill', 'sha256:zzz'), item)).toBe(false);
  });

  it('content-hash fast path short-circuits regardless of ref form', () => {
    expect(localMatchesManifest(entry('unrelated-name', item.content_hash), item)).toBe(true);
    expect(localMatchesManifest(entry('someoneelse/unrelated', item.content_hash), item)).toBe(true);
    expect(localMatchesManifest(entry('someoneelse:unrelated', item.content_hash), item)).toBe(true);
  });

  it('findLocalForManifestItem prefers the canonical ref', () => {
    const state: KitState = {
      version: 1,
      skills: {
        'skillet-sync': entry('skillet-sync', item.content_hash),
        '@thiago/skillet-sync': entry('@thiago/skillet-sync', item.content_hash),
      },
    };
    const match = findLocalForManifestItem(state, item);
    expect(match?.slug).toBe('@thiago/skillet-sync');
  });

  it('alignEntryToManifest stamps sourceKit and canonical slug', () => {
    const aligned = alignEntryToManifest(entry('skillet-sync', item.content_hash), item);
    expect(aligned.slug).toBe('@thiago/skillet-sync');
    expect(aligned.sourceKit).toBe('@thiago/partner-kit');
    expect(aligned.sourceClass).toBe('own-kit');
  });

  it('alignEntryToManifest classifies external_author skills as external', () => {
    const externalItem: SyncManifestItem = { ...item, external_author: true };
    const aligned = alignEntryToManifest(entry('skillet-sync', item.content_hash), externalItem);
    expect(aligned.sourceClass).toBe('external');
  });

  it('alignEntryToManifest carries version_label when the hashes agree', () => {
    const labeled: SyncManifestItem = { ...item, version_label: '1.2.0' };
    const aligned = alignEntryToManifest(entry('skillet-sync', item.content_hash), labeled);
    expect(aligned.versionLabel).toBe('1.2.0');
  });

  it('alignEntryToManifest skips version_label on a slug-only match', () => {
    const labeled: SyncManifestItem = { ...item, version_label: '1.2.0' };
    const aligned = alignEntryToManifest(entry('skillet-sync', 'sha256:other'), labeled);
    expect(aligned.versionLabel).toBeUndefined();
  });

  it('alignEntryToManifest carries token weight when the hashes agree', () => {
    const withTokens: SyncManifestItem = {
      ...item,
      token_count: 1320,
      token_ambient: 84,
      token_method: 'gpt-tokenizer-o200k',
    };
    const aligned = alignEntryToManifest(entry('skillet-sync', item.content_hash), withTokens);
    expect(aligned.tokenCount).toBe(1320);
    expect(aligned.tokenAmbient).toBe(84);
    expect(aligned.tokenMethod).toBe('gpt-tokenizer-o200k');
  });

  it('alignEntryToManifest skips token weight on a slug-only (behind) match', () => {
    const withTokens: SyncManifestItem = {
      ...item,
      token_count: 1320,
      token_ambient: 84,
      token_method: 'gpt-tokenizer-o200k',
    };
    const aligned = alignEntryToManifest(entry('skillet-sync', 'sha256:other'), withTokens);
    expect(aligned.tokenCount).toBeUndefined();
    expect(aligned.tokenAmbient).toBeUndefined();
  });

  it('alignEntryToManifest drops a hostile version_label', () => {
    const hostile: SyncManifestItem = { ...item, version_label: '1.2.3[31m' };
    const aligned = alignEntryToManifest(entry('skillet-sync', item.content_hash), hostile);
    expect(aligned.versionLabel).toBeUndefined();
  });

  it('sanitizeVersionLabel accepts only X.Y.Z strings', () => {
    expect(sanitizeVersionLabel('1.2.3')).toBe('1.2.3');
    expect(sanitizeVersionLabel('0.0.0')).toBe('0.0.0');
    expect(sanitizeVersionLabel('1.2.3[31m')).toBeUndefined();
    expect(sanitizeVersionLabel('v1"quote')).toBeUndefined();
    expect(sanitizeVersionLabel('1.2')).toBeUndefined();
    expect(sanitizeVersionLabel(undefined)).toBeUndefined();
    expect(sanitizeVersionLabel(123)).toBeUndefined();
  });
});
