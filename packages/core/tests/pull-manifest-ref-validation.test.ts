/**
 * H1 — pullFromUnionManifest validates each manifest item.ref BEFORE it reaches
 * any filesystem path op. A hostile/compromised registry returning a traversal
 * ref (e.g. "../../../tmp/evil") that collides on a known content_hash must not
 * move the matched local skill dir out of ~/.skillet/skills via the
 * alias-promotion rename.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-pull-ref')
})

import { pullFromUnionManifest } from '../src/registry/pull.js';
import { writeBundleToSkillStore, skillContentDir } from '../src/kit/store.js';
import { canonicalContentHash, type DecodedBundle } from '@skillet/protocol';
import type { KitState, SkillEntry } from '../src/kit/types.js';

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

const LOCAL_SLUG = '@alice/real';

function localBundle(): DecodedBundle {
  return new Map([['SKILL.md', Buffer.from('---\nname: real\n---\n\nHi.\n')]]);
}

function manifestResponse(item: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      schema_version: 1,
      etag: 'sha256:' + '0'.repeat(64),
      sync_interval_seconds: null,
      account_scope: 'user',
      items: [item],
    }),
    { status: 200, headers: { etag: '"x"', 'content-type': 'application/json' } },
  );
}

describe('pullFromUnionManifest ref validation (H1)', () => {
  let contentHash: string;
  let state: KitState;

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    const bundle = localBundle();
    contentHash = canonicalContentHash(bundle);
    await writeBundleToSkillStore(LOCAL_SLUG, bundle);
    const entry: SkillEntry = {
      slug: LOCAL_SLUG,
      owner: 'alice',
      name: 'real',
      description: '',
      version: 1,
      hash: contentHash,
      source: 'registry',
      importedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as SkillEntry;
    state = { version: 1, skills: { [LOCAL_SLUG]: entry } } as KitState;
  });
  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('rejects a traversal ref colliding on content_hash; local dir is not moved', async () => {
    const evilRef = '../../../tmp/skillet-evil';
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/sync/manifest')) {
        return manifestResponse({
          ref: evilRef,
          version: 1,
          content_hash: contentHash, // collide with the local skill
          signature: null,
          author_key_id: null,
          policy: 'manual',
          source_kit: null,
          external_author: true,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.test',
      token: 'skillet_d_test',
      pinDir: join(TEST_ROOT, 'pins'),
      fetchImpl,
    });

    // The traversal ref was refused before any path op.
    const failed = res.outcomes.find((o) => o.slug === evilRef);
    expect(failed?.status).toBe('failed');
    expect(failed?.reason).toBe('invalid_ref');

    // The local skill dir is still in place — not renamed out of the store.
    expect(await exists(join(skillContentDir(LOCAL_SLUG), 'SKILL.md'))).toBe(true);
    // No directory escaped to the traversal target.
    expect(await exists(join(TEST_ROOT, '..', '..', 'tmp', 'skillet-evil'))).toBe(false);
  });

  it('skips a malformed ref without throwing, leaving the store intact', async () => {
    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/sync/manifest')) {
        return manifestResponse({
          ref: 'no-leading-at-or-slash',
          version: 1,
          content_hash: 'sha256:' + '1'.repeat(64),
          signature: null,
          author_key_id: null,
          policy: 'manual',
          source_kit: null,
          external_author: true,
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.test',
      token: 'skillet_d_test',
      pinDir: join(TEST_ROOT, 'pins'),
      fetchImpl,
    });

    expect(res.outcomes.find((o) => o.slug === 'no-leading-at-or-slash')?.reason).toBe('invalid_ref');
    expect(await exists(join(skillContentDir(LOCAL_SLUG), 'SKILL.md'))).toBe(true);
  });
});
