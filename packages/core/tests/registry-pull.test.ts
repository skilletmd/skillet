/**
 * pullRegistryUpdates() unit tests (AC 2 + 4).
 *
 * Stands up a fake fetch that mimics the manifest + version endpoints for a
 * controlled author keypair. The pull function is exercised against an
 * isolated KitState + temp pin/etag/skill dirs so we can assert:
 *
 *   - 200 with a new latest_hash → bundle fetched, signature verified, kit
 *     entry mutated, local skill store rewritten
 *   - 304 → entry untouched, ETag cache still has the value we sent
 *   - same latest_hash → no version fetch, status='unchanged'
 *   - pinned entry → registry never contacted, status='skipped-pinned'
 *   - interactive=false → registry never contacted, status='skipped-unattended'
 *   - bad signature → status='failed', entry untouched, no disk overwrite
 *
 * Isolation: HOME and SKILLET_DIR redirected via vi.hoisted BEFORE @skillet/core
 * loads, so the skill store + pin dir + etag cache all live in a temp tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-pull-test')
})

import { pullRegistryUpdates, pullFromUnionManifest } from '../src/registry/pull.js';
import { writeBundleToSkillStore, readBundleFromSkillStore, readState, upsertSkill } from '../src/kit/store.js';
import {
  acceptAuthorKeyRotationWithInvalidation,
  invalidateAfterKeyRotation,
} from '../src/registry/rotation-invalidate.js';
import { generateAuthorKey } from '../src/signing/index.js';
import { signEnvelope } from '../src/signing/envelope.js';
import {
  canonicalContentHash,
  encodeBundle,
  type BundleFiles,
  type DecodedBundle,
} from '@skillet/protocol';
import type { KitState, SkillEntry } from '../src/kit/types.js';

function pubB64(k: ReturnType<typeof generateAuthorKey>): string {
  const jwk = k.publicKey.export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

function bundleOf(text: string): DecodedBundle {
  return new Map([
    [
      'SKILL.md',
      Buffer.from(
        `---\nname: festival-ops\ndescription: x\n---\n${text}\n`,
        'utf8',
      ),
    ],
  ]);
}

interface FakeRegistry {
  manifestETag: string;
  manifestStatus: number;
  /** Latest content hash WITHOUT sha256: prefix (matches server). */
  latestHash: string;
  bundleFiles: BundleFiles;
  signatureB64: string;
  authorKeyId: string;
  authorPub: string;
  hits: { manifest: number; version: number };
  fetchImpl: typeof fetch;
}

function buildFakeRegistry(
  bundle: DecodedBundle,
  key: ReturnType<typeof generateAuthorKey>,
  opts: { versionLabel?: string } = {},
): FakeRegistry {
  const labelField = opts.versionLabel ? { version_label: opts.versionLabel } : {};
  const recomputedPrefixed = canonicalContentHash(bundle);
  const latestHash = recomputedPrefixed.slice('sha256:'.length);
  const envelope = signEnvelope(recomputedPrefixed, key);
  const files = encodeBundle(bundle);
  const reg: FakeRegistry = {
    manifestETag: `"${recomputedPrefixed}"`,
    manifestStatus: 200,
    latestHash,
    bundleFiles: files,
    signatureB64: envelope.sig,
    authorKeyId: key.keyId,
    authorPub: pubB64(key),
    hits: { manifest: 0, version: 0 },
    fetchImpl: (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (url.includes('/sync/manifest')) {
        return new Response(
          JSON.stringify({
            schema_version: 1,
            etag: 'sha256:' + '0'.repeat(64),
            sync_interval_seconds: null,
            account_scope: 'user',
            items: [
              {
                ref: '@taylor/festival-ops',
                version: 1,
                ...labelField,
                content_hash: `sha256:${reg.latestHash}`,
                signature: { alg: 'ed25519', key_id: key.keyId, sig: reg.signatureB64 },
                author_key_id: reg.authorKeyId,
                policy: 'manual',
                source_kit: '@taylor/kit',
                external_author: false,
              },
            ],
          }),
          { status: 200, headers: { etag: '"union"', 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/manifest')) {
        reg.hits.manifest++;
        if (headers['if-none-match'] === reg.manifestETag) {
          return new Response(null, {
            status: 304,
            headers: { etag: reg.manifestETag },
          });
        }
        return new Response(
          JSON.stringify({
            author: 'taylor',
            slug: 'festival-ops',
            skill_id: 'taylor:festival-ops',
            latest_hash: reg.latestHash,
            install_count: 0,
            author_key_id: reg.authorKeyId,
            author_public_key: reg.authorPub,
            versions: [
              {
                hash: reg.latestHash,
                published_at: 100,
                ...labelField,
                url: `/api/v1/skills/taylor/festival-ops/versions/${reg.latestHash}`,
                signature: { alg: 'ed25519', key_id: key.keyId, sig: reg.signatureB64 },
              },
            ],
          }),
          {
            status: 200,
            headers: {
              etag: reg.manifestETag,
              'content-type': 'application/json',
            },
          },
        );
      }
      if (url.includes('/versions/')) {
        reg.hits.version++;
        return new Response(
          JSON.stringify({
            hash: reg.latestHash,
            skill_id: 'taylor:festival-ops',
            author: 'taylor',
            slug: 'festival-ops',
            files: reg.bundleFiles,
            content_hash: `sha256:${reg.latestHash}`,
            signature: { alg: 'ed25519', key_id: key.keyId, sig: reg.signatureB64 },
            author_key_id: reg.authorKeyId,
            author_public_key: reg.authorPub,
            metadata: {},
            published_at: 100,
            published_by: 'taylor',
            ...labelField,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unhandled fake-fetch URL: ${url}`);
    }) as unknown as typeof fetch,
  };
  return reg;
}

function makeEntry(overrides: Partial<SkillEntry> = {}): SkillEntry {
  return {
    slug: '@taylor/festival-ops',
    owner: 'taylor',
    name: 'festival-ops',
    description: 'x',
    version: 1,
    hash: 'sha256:' + '00'.repeat(32),
    source: 'registry',
    registryUrl: 'https://registry.example.com',
    authorKeyId: '00'.repeat(32),
    authorPubBase64: 'AAAA',
    signature: { alg: 'ed25519', key_id: '00'.repeat(32), sig: 'sig' },
    importedAt: '2026-06-13T00:00:00Z',
    updatedAt: '2026-06-13T00:00:00Z',
    ...overrides,
  };
}

describe('pullRegistryUpdates', () => {
  let pinDir: string;
  let etagPath: string;

  beforeEach(async () => {
    pinDir = join(TEST_ROOT, '.skillet-pin', String(Math.random()));
    etagPath = join(TEST_ROOT, '.skillet-etag', String(Math.random()), 'etag.json');
    await mkdir(pinDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });

  it('pulls a new latest_hash, verifies, rewrites local bundle', async () => {
    const key = generateAuthorKey();
    const oldBundle = bundleOf('v1 body');
    const newBundle = bundleOf('v2 body');
    const reg = buildFakeRegistry(newBundle, key);

    await writeBundleToSkillStore('@taylor/festival-ops', oldBundle);

    const oldHash = canonicalContentHash(oldBundle);
    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: oldHash,
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe('updated');
    expect(outcomes[0].newHash).toBe(`sha256:${reg.latestHash}`);
    expect(state.skills['@taylor/festival-ops'].hash).toBe(`sha256:${reg.latestHash}`);
    // Label-less server (older registry) → the entry stays valid with no label.
    expect(state.skills['@taylor/festival-ops']).not.toHaveProperty('versionLabel');

    const written = await readBundleFromSkillStore('@taylor/festival-ops');
    expect(canonicalContentHash(written)).toBe(`sha256:${reg.latestHash}`);

    // ETag cache was persisted with the manifest's strong ETag.
    const cache = JSON.parse(await readFile(etagPath, 'utf8')) as {
      entries: Record<string, string>;
    };
    expect(cache.entries['@taylor/festival-ops']).toBe(reg.manifestETag);
  });

  it('U3: preserves a live store edit instead of clobbering it on pull, and holds the update', async () => {
    const key = generateAuthorKey();
    const v1 = bundleOf('v1 body');
    const edited = bundleOf('LOCAL EDIT body');
    const v2 = bundleOf('v2 body');
    const reg = buildFakeRegistry(v2, key);

    // The store holds the user's EDIT; state says the materialized baseline is v1.
    await writeBundleToSkillStore('@taylor/festival-ops', edited);
    const v1Hash = canonicalContentHash(v1);
    const editedHash = canonicalContentHash(edited);
    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: v1Hash,
          materialized_hash: v1Hash,
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    // The store STILL holds the edit — the author v2 bytes did not overwrite it.
    const store = await readBundleFromSkillStore('@taylor/festival-ops');
    expect(canonicalContentHash(store)).toBe(editedHash);
    // entry.hash advanced to the pending author version so sync holds it.
    expect(state.skills['@taylor/festival-ops'].hash).toBe(`sha256:${reg.latestHash}`);
  });

  it('R8 post-capture: an ALREADY-customized edit is not clobbered on the next author update', async () => {
    // Regression: once a store edit is captured, materialized_hash advances to
    // the EDITED bytes, so the store no longer "drifts" from its baseline. The
    // drift-only guard used to see no edit and let the author's new version
    // overwrite the captured edit (silent data loss). customized_from must keep
    // the store protected until `edits take`.
    const key = generateAuthorKey();
    const edited = bundleOf('CAPTURED LOCAL EDIT body');
    const v2 = bundleOf('v2 author body');
    const reg = buildFakeRegistry(v2, key);

    await writeBundleToSkillStore('@taylor/festival-ops', edited);
    const editedHash = canonicalContentHash(edited);
    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: editedHash,
          // Capture set materialized_hash to the EDITED bytes and recorded the
          // clean baseline the edit was made from.
          materialized_hash: editedHash,
          customized_from: { author: 'taylor', slug: '@taylor/festival-ops', version: 1, hash: 'sha256:' + '11'.repeat(32) },
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    // The store STILL holds the captured edit; the author v2 was not written.
    const store = await readBundleFromSkillStore('@taylor/festival-ops');
    expect(canonicalContentHash(store)).toBe(editedHash);
    // The new version is held (entry.hash advances) so the update surfaces.
    expect(state.skills['@taylor/festival-ops'].hash).toBe(`sha256:${reg.latestHash}`);
  });

  it('U3: a CLEAN store (matches the materialized baseline) is still overwritten on pull', async () => {
    const key = generateAuthorKey();
    const v1 = bundleOf('v1 body');
    const v2 = bundleOf('v2 body');
    const reg = buildFakeRegistry(v2, key);

    await writeBundleToSkillStore('@taylor/festival-ops', v1);
    const v1Hash = canonicalContentHash(v1);
    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: v1Hash,
          materialized_hash: v1Hash,
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    // No edit to protect → the guard does not fire and v2 lands in the store.
    const store = await readBundleFromSkillStore('@taylor/festival-ops');
    expect(canonicalContentHash(store)).toBe(`sha256:${reg.latestHash}`);
  });

  it('reject-stale-stage: a PENDING (non-stable, non-customized) store is overwritten, not preserved as an edit', async () => {
    // Consent-integrity regression. Repro: an interactive sync staged v2 bytes
    // into the store (store=v2) but the user REJECTED v2 so it was never
    // materialized (materialized_hash stays v1). entry.hash advanced to v2 with
    // the staged pull. The store difference here is our OWN pending stage, NOT a
    // user edit — the skill is non-stable (materialized_hash !== hash) and not
    // customized. When v3 arrives, pull must overwrite the store with v3 bytes.
    // The bug: preserveLiveStoreEdit misread the v2 drift as a live edit, kept
    // the stale v2 bytes, and stamped entry.hash=v3 — so a later approve
    // materialized v2's bytes stamped as v3 (hash/content drift).
    const key = generateAuthorKey();
    const v1 = bundleOf('v1 body');
    const v2Staged = bundleOf('v2 REJECTED body');
    const v3 = bundleOf('v3 body');
    const reg = buildFakeRegistry(v3, key);

    // Store holds the rejected-but-staged v2 bytes; agents are still on v1.
    await writeBundleToSkillStore('@taylor/festival-ops', v2Staged);
    const v1Hash = canonicalContentHash(v1);
    const v2Hash = canonicalContentHash(v2Staged);
    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          // entry.hash advanced to the pending v2 that the prior sync staged...
          hash: v2Hash,
          // ...but materialized_hash lags at v1 (v2 was rejected, never applied).
          materialized_hash: v1Hash,
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    // The store must now hold v3's bytes — no stale v2 left to be stamped as v3.
    const store = await readBundleFromSkillStore('@taylor/festival-ops');
    expect(canonicalContentHash(store)).toBe(`sha256:${reg.latestHash}`);
    // And state agrees: entry.hash === the store's content hash (no drift).
    expect(state.skills['@taylor/festival-ops'].hash).toBe(`sha256:${reg.latestHash}`);
  });

  it('persists the served version_label on the updated entry and on disk', async () => {
    const key = generateAuthorKey();
    const oldBundle = bundleOf('v1 body');
    const newBundle = bundleOf('v2 body');
    const reg = buildFakeRegistry(newBundle, key, { versionLabel: '1.1.0' });

    await writeBundleToSkillStore('@taylor/festival-ops', oldBundle);
    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: canonicalContentHash(oldBundle),
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(outcomes[0].status).toBe('updated');
    expect(state.skills['@taylor/festival-ops'].versionLabel).toBe('1.1.0');
    // upsertSkill persisted the label into state.json alongside the integer.
    const persisted = await readState();
    expect(persisted.skills['@taylor/festival-ops'].versionLabel).toBe('1.1.0');
    expect(persisted.skills['@taylor/festival-ops'].version).toBe(1);
  });

  it('drops a hostile version_label served by the registry', async () => {
    const key = generateAuthorKey();
    const oldBundle = bundleOf('v1 body');
    const newBundle = bundleOf('v2 body');
    const reg = buildFakeRegistry(newBundle, key, { versionLabel: '1.2.3[31m' });

    await writeBundleToSkillStore('@taylor/festival-ops', oldBundle);
    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: canonicalContentHash(oldBundle),
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(outcomes[0].status).toBe('updated');
    expect(state.skills['@taylor/festival-ops']).not.toHaveProperty('versionLabel');
  });

  it('gains the manifest label on a 200 with an unchanged latest_hash', async () => {
    const key = generateAuthorKey();
    const bundle = bundleOf('same body');
    const reg = buildFakeRegistry(bundle, key, { versionLabel: '2.3.4' });
    await writeBundleToSkillStore('@taylor/festival-ops', bundle);

    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: canonicalContentHash(bundle),
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(outcomes[0].status).toBe('unchanged');
    expect(state.skills['@taylor/festival-ops'].versionLabel).toBe('2.3.4');
    const persisted = await readState();
    expect(persisted.skills['@taylor/festival-ops'].versionLabel).toBe('2.3.4');
  });

  it('clears a stale versionLabel when the server serves none', async () => {
    const key = generateAuthorKey();
    const oldBundle = bundleOf('v1 body');
    const newBundle = bundleOf('v2 body');
    const reg = buildFakeRegistry(newBundle, key);

    await writeBundleToSkillStore('@taylor/festival-ops', oldBundle);
    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: canonicalContentHash(oldBundle),
          versionLabel: '9.9.9',
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(outcomes[0].status).toBe('updated');
    expect(state.skills['@taylor/festival-ops']).not.toHaveProperty('versionLabel');
  });

  it('consults getRevokedKeys with the entry\'s own registry URL (per-registry revocation)', async () => {
    const key = generateAuthorKey();
    const oldBundle = bundleOf('v1 body');
    const newBundle = bundleOf('v2 body');
    const reg = buildFakeRegistry(newBundle, key);
    await writeBundleToSkillStore('@taylor/festival-ops', oldBundle);

    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: canonicalContentHash(oldBundle),
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
          registryUrl: 'https://registry.example.com',
        }),
      },
    };

    const getRevokedKeys = vi.fn(async () => new Set<string>());
    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      getRevokedKeys,
      fetchImpl: reg.fetchImpl,
    });

    expect(outcomes[0].status).toBe('updated');
    // The revocation set was resolved for THIS entry's serving registry, not a
    // single default — the core of the per-registry fix.
    expect(getRevokedKeys).toHaveBeenCalledWith('https://registry.example.com');
  });

  it('rejects a manifest that would roll back entry.version', async () => {
    const key = generateAuthorKey();
    const v1Bundle = bundleOf('v1 body');
    const v2Bundle = bundleOf('v2 body');
    const v1Hash = canonicalContentHash(v1Bundle).slice('sha256:'.length);
    const v2Hash = canonicalContentHash(v2Bundle).slice('sha256:'.length);
    const v1Sig = signEnvelope(`sha256:${v1Hash}`, key);
    const v2Sig = signEnvelope(`sha256:${v2Hash}`, key);

    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/manifest')) {
        return new Response(
          JSON.stringify({
            author: 'taylor',
            slug: 'festival-ops',
            skill_id: 'taylor:festival-ops',
            latest_hash: v1Hash,
            install_count: 0,
            author_key_id: key.keyId,
            author_public_key: pubB64(key),
            versions: [
              {
                hash: v2Hash,
                published_at: 200,
                url: `/api/v1/skills/taylor/festival-ops/versions/${v2Hash}`,
                signature: { alg: 'ed25519', key_id: key.keyId, sig: v2Sig.sig },
              },
              {
                hash: v1Hash,
                published_at: 100,
                url: `/api/v1/skills/taylor/festival-ops/versions/${v1Hash}`,
                signature: { alg: 'ed25519', key_id: key.keyId, sig: v1Sig.sig },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/versions/')) {
        const hashInUrl = decodeURIComponent(url.split('/versions/')[1]!.split('?')[0]!);
        const bare = hashInUrl.startsWith('sha256:') ? hashInUrl.slice('sha256:'.length) : hashInUrl;
        if (bare !== v1Hash) throw new Error(`unhandled version hash: ${bare}`);
        return new Response(
          JSON.stringify({
            hash: v1Hash,
            skill_id: 'taylor:festival-ops',
            author: 'taylor',
            slug: 'festival-ops',
            files: encodeBundle(v1Bundle),
            content_hash: `sha256:${v1Hash}`,
            signature: { alg: 'ed25519', key_id: key.keyId, sig: v1Sig.sig },
            author_key_id: key.keyId,
            author_public_key: pubB64(key),
            metadata: {},
            published_at: 100,
            published_by: 'taylor',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unhandled: ${url}`);
    }) as unknown as typeof fetch;

    await writeBundleToSkillStore('@taylor/festival-ops', v2Bundle);
    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: canonicalContentHash(v2Bundle),
          version: 2,
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl,
    });

    expect(outcomes[0].status).toBe('failed');
    expect(outcomes[0].reason).toContain('rollback_detected');
    expect(state.skills['@taylor/festival-ops'].version).toBe(2);
    expect(state.skills['@taylor/festival-ops'].hash).toBe(canonicalContentHash(v2Bundle));
  });

  it('honours 304 — no version fetch, cache still has ETag, entry untouched', async () => {
    const key = generateAuthorKey();
    const bundle = bundleOf('same');
    const reg = buildFakeRegistry(bundle, key);
    await writeBundleToSkillStore('@taylor/festival-ops', bundle);

    // Pre-seed the ETag cache so the manifest call returns 304.
    await mkdir(join(etagPath, '..'), { recursive: true });
    await writeFile(
      etagPath,
      JSON.stringify({ version: 1, entries: { '@taylor/festival-ops': reg.manifestETag } }),
    );

    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: canonicalContentHash(bundle),
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(outcomes[0].status).toBe('unchanged');
    expect(reg.hits.manifest).toBe(1);
    expect(reg.hits.version).toBe(0);
  });

  it('repairs store drift when entry.hash matches manifest on 200 unchanged latest_hash', async () => {
    const key = generateAuthorKey();
    const correctBundle = bundleOf('registry truth');
    const wrongBundle = bundleOf('stale local bytes');
    const reg = buildFakeRegistry(correctBundle, key);
    const correctHash = canonicalContentHash(correctBundle);

    await writeBundleToSkillStore('@taylor/festival-ops', wrongBundle);

    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: correctHash,
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(outcomes[0].status).toBe('updated');
    expect(reg.hits.version).toBe(1);
    const onDisk = await readBundleFromSkillStore('@taylor/festival-ops');
    expect(canonicalContentHash(onDisk)).toBe(correctHash);
    expect(state.skills['@taylor/festival-ops'].hash).toBe(correctHash);
  });

  it('repairs store drift on 304 when state hash still matches registry', async () => {
    const key = generateAuthorKey();
    const correctBundle = bundleOf('registry truth');
    const wrongBundle = bundleOf('stale local bytes');
    const reg = buildFakeRegistry(correctBundle, key);
    const correctHash = canonicalContentHash(correctBundle);

    await writeBundleToSkillStore('@taylor/festival-ops', wrongBundle);
    await mkdir(join(etagPath, '..'), { recursive: true });
    await writeFile(
      etagPath,
      JSON.stringify({ version: 1, entries: { '@taylor/festival-ops': reg.manifestETag } }),
    );

    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: correctHash,
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(outcomes[0].status).toBe('updated');
    expect(reg.hits.version).toBe(1);
    const onDisk = await readBundleFromSkillStore('@taylor/festival-ops');
    expect(canonicalContentHash(onDisk)).toBe(correctHash);
  });

  it('skipped-pinned never hits the network', async () => {
    const key = generateAuthorKey();
    const reg = buildFakeRegistry(bundleOf('v2'), key);
    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          pinned: true,
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };
    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });
    expect(outcomes[0].status).toBe('skipped-pinned');
    expect(reg.hits.manifest).toBe(0);
  });

  it('headless rule: interactive=false skips pull entirely', async () => {
    const key = generateAuthorKey();
    const reg = buildFakeRegistry(bundleOf('v2'), key);
    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };
    const outcomes = await pullRegistryUpdates(state, {
      interactive: false,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });
    expect(outcomes[0].status).toBe('skipped-unattended');
    expect(reg.hits.manifest).toBe(0);
  });

  it('bad signature → status failed, on-disk bytes untouched, entry untouched', async () => {
    const realKey = generateAuthorKey();
    const attackerKey = generateAuthorKey();
    const oldBundle = bundleOf('legit');
    const newBundle = bundleOf('tampered');
    const reg = buildFakeRegistry(newBundle, realKey);
    // Swap the served pubkey out from under the signature — server is lying
    // about which key signed the new version. resolveAuthorKey will pin the
    // attacker pubkey (no prior pin), then verifyEnvelope MUST refuse: the
    // signature was produced by realKey, not attackerKey.
    reg.authorPub = pubB64(attackerKey);

    await writeBundleToSkillStore('@taylor/festival-ops', oldBundle);
    const oldHash = canonicalContentHash(oldBundle);

    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: oldHash,
          authorKeyId: realKey.keyId,
          authorPubBase64: pubB64(realKey),
        }),
      },
    };

    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });
    expect(outcomes[0].status).toBe('failed');
    expect(outcomes[0].reason).toMatch(
      /key_id_mismatch|signature_invalid|integrity_failed/,
    );
    // Entry hash + bundle on disk both preserved.
    expect(state.skills['@taylor/festival-ops'].hash).toBe(oldHash);
    const onDisk = await readBundleFromSkillStore('@taylor/festival-ops');
    expect(canonicalContentHash(onDisk)).toBe(oldHash);
  });

  it('mismatched (key_id, pub) pair is rejected BEFORE any pin (the finding)', async () => {
    // First-sight pull. Registry serves a victim key_id bound to an attacker
    // pub: key_id !== hex(pub). The binding check must fail before TOFU pins.
    const victimKey = generateAuthorKey();
    const attackerKey = generateAuthorKey();
    const newBundle = bundleOf('attacker payload');
    const reg = buildFakeRegistry(newBundle, attackerKey);
    // Claim the victim's key_id while serving the attacker's actual pub.
    reg.authorKeyId = victimKey.keyId;

    await writeBundleToSkillStore('@taylor/festival-ops', bundleOf('legit'));
    const oldHash = canonicalContentHash(bundleOf('legit'));

    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: oldHash,
          // No prior pin on disk → first-sight TOFU path.
          authorKeyId: victimKey.keyId,
          authorPubBase64: pubB64(attackerKey),
        }),
      },
    };

    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(outcomes[0].status).toBe('failed');
    expect(outcomes[0].reason).toMatch(/signature_invalid|does not match author_pub/);
    // Nothing was pinned for the handle — the attacker pub never touched disk.
    const pinned = await readdir(pinDir).catch(() => [] as string[]);
    expect(pinned.filter((f) => f.endsWith('.pub.json'))).toEqual([]);
    // Entry + on-disk bytes untouched.
    expect(state.skills['@taylor/festival-ops'].hash).toBe(oldHash);
  });
});

describe('pullFromUnionManifest version labels', () => {
  let pinDir: string;
  let etagPath: string;

  beforeEach(async () => {
    pinDir = join(TEST_ROOT, '.skillet-pin', String(Math.random()));
    etagPath = join(TEST_ROOT, '.skillet-etag', String(Math.random()), 'etag.json');
    await mkdir(pinDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });

  it('persists the manifest item version_label on a freshly fetched entry', async () => {
    const key = generateAuthorKey();
    const reg = buildFakeRegistry(bundleOf('fresh body'), key, { versionLabel: '2.0.0' });
    const state: KitState = { version: 1, skills: {} };

    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.example.com',
      token: 'skillet_d_test',
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(res.outcomes[0].status).toBe('updated');
    expect(state.skills['@taylor/festival-ops'].versionLabel).toBe('2.0.0');
    expect(state.skills['@taylor/festival-ops'].version).toBe(1);
  });

  it('leaves the entry label-less when the manifest carries no version_label', async () => {
    const key = generateAuthorKey();
    const reg = buildFakeRegistry(bundleOf('fresh body'), key);
    const state: KitState = { version: 1, skills: {} };

    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.example.com',
      token: 'skillet_d_test',
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(res.outcomes[0].status).toBe('updated');
    expect(state.skills['@taylor/festival-ops'].versionLabel).toBeUndefined();
  });

  it('carries version_label onto an unchanged entry realigned to the manifest', async () => {
    const key = generateAuthorKey();
    const bundle = bundleOf('same body');
    const reg = buildFakeRegistry(bundle, key, { versionLabel: '1.0.2' });
    await writeBundleToSkillStore('@taylor/festival-ops', bundle);

    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: canonicalContentHash(bundle),
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.example.com',
      token: 'skillet_d_test',
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(res.outcomes[0].status).toBe('unchanged');
    expect(state.skills['@taylor/festival-ops'].versionLabel).toBe('1.0.2');
  });

  it('repairs store drift when union manifest content_hash matches state but store bytes differ', async () => {
    const key = generateAuthorKey();
    const correctBundle = bundleOf('registry truth');
    const wrongBundle = bundleOf('stale local bytes');
    const reg = buildFakeRegistry(correctBundle, key);
    const correctHash = canonicalContentHash(correctBundle);

    await writeBundleToSkillStore('@taylor/festival-ops', wrongBundle);

    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: correctHash,
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
        }),
      },
    };

    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.example.com',
      token: 'skillet_d_test',
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(res.outcomes[0].status).toBe('updated');
    expect(reg.hits.version).toBe(1);
    const onDisk = await readBundleFromSkillStore('@taylor/festival-ops');
    expect(canonicalContentHash(onDisk)).toBe(correctHash);
    expect(state.skills['@taylor/festival-ops'].hash).toBe(correctHash);
  });

  it('gains the manifest label on an already-synced unchanged entry (outcome stays unchanged)', async () => {
    const key = generateAuthorKey();
    const bundle = bundleOf('same body');
    const reg = buildFakeRegistry(bundle, key, { versionLabel: '3.4.5' });
    await writeBundleToSkillStore('@taylor/festival-ops', bundle);

    const state: KitState = {
      version: 1,
      skills: {
        '@taylor/festival-ops': makeEntry({
          hash: canonicalContentHash(bundle),
          authorKeyId: key.keyId,
          authorPubBase64: pubB64(key),
          // sourceKit already set and no alias present → the alias-promotion
          // shortcut is skipped, exercising the plain unchanged-branch label
          // update path instead.
          sourceKit: '@taylor/kit',
        }),
      },
    };

    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.example.com',
      token: 'skillet_d_test',
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(res.outcomes[0].status).toBe('unchanged');
    expect(state.skills['@taylor/festival-ops'].versionLabel).toBe('3.4.5');
    const persisted = await readState();
    expect(persisted.skills['@taylor/festival-ops'].versionLabel).toBe('3.4.5');
  });

  it('drops a hostile version_label from a freshly fetched entry', async () => {
    const key = generateAuthorKey();
    const reg = buildFakeRegistry(bundleOf('fresh body'), key, { versionLabel: 'v1"quote' });
    const state: KitState = { version: 1, skills: {} };

    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.example.com',
      token: 'skillet_d_test',
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });

    expect(res.outcomes[0].status).toBe('updated');
    expect(state.skills['@taylor/festival-ops'].versionLabel).toBeUndefined();
  });

  it('drops the manifest label when its declared version does not match the fetched version', async () => {
    const key = generateAuthorKey();
    const bundle = bundleOf('fresh body');
    const hash = canonicalContentHash(bundle).slice('sha256:'.length);
    const sig = signEnvelope(`sha256:${hash}`, key);
    const files = encodeBundle(bundle);

    const fetchImpl = (async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/sync/manifest')) {
        return new Response(
          JSON.stringify({
            schema_version: 1,
            etag: 'sha256:' + '0'.repeat(64),
            sync_interval_seconds: null,
            account_scope: 'user',
            items: [
              {
                ref: '@taylor/festival-ops',
                version: 2,
                version_label: '4.0.0',
                content_hash: `sha256:${hash}`,
                signature: { alg: 'ed25519', key_id: key.keyId, sig: sig.sig },
                author_key_id: key.keyId,
                policy: 'manual',
                source_kit: '@taylor/kit',
                external_author: false,
              },
            ],
          }),
          { status: 200, headers: { etag: '"union"', 'content-type': 'application/json' } },
        );
      }
      if (url.endsWith('/manifest')) {
        return new Response(
          JSON.stringify({
            author: 'taylor',
            slug: 'festival-ops',
            skill_id: 'taylor:festival-ops',
            latest_hash: hash,
            install_count: 0,
            author_key_id: key.keyId,
            author_public_key: pubB64(key),
            versions: [
              {
                hash,
                published_at: 100,
                url: `/api/v1/skills/taylor/festival-ops/versions/${hash}`,
                signature: { alg: 'ed25519', key_id: key.keyId, sig: sig.sig },
              },
            ],
          }),
          { status: 200, headers: { etag: `"${hash}"`, 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/versions/')) {
        return new Response(
          JSON.stringify({
            hash,
            skill_id: 'taylor:festival-ops',
            author: 'taylor',
            slug: 'festival-ops',
            files,
            content_hash: `sha256:${hash}`,
            signature: { alg: 'ed25519', key_id: key.keyId, sig: sig.sig },
            author_key_id: key.keyId,
            author_public_key: pubB64(key),
            metadata: {},
            published_at: 100,
            published_by: 'taylor',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unhandled fake-fetch URL: ${url}`);
    }) as unknown as typeof fetch;

    const state: KitState = { version: 1, skills: {} };
    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.example.com',
      token: 'skillet_d_test',
      pinDir,
      etagCachePath: etagPath,
      fetchImpl,
    });

    expect(res.outcomes[0].status).toBe('updated');
    // The fetched version is 1 (a single entry in `versions`), but the manifest
    // item claims version 2 — the label describes a version we did not fetch.
    expect(state.skills['@taylor/festival-ops'].versionLabel).toBeUndefined();
  });
});

// ── Key-rotation recovery (rotation-invalidate + needsKeyReverify) ──────────
// A rotation re-signs versions without changing content hashes, so the
// hash-equality `unchanged` short-circuits never reach verification. Accepting
// a rotation flags the handle's entries; flagged entries take the fetch path
// and are rewritten (hash + envelope + identity) against the current pin.
describe('key rotation recovery', () => {
  let pinDir: string;
  let etagPath: string;

  beforeEach(async () => {
    pinDir = join(TEST_ROOT, '.skillet-pin', String(Math.random()));
    etagPath = join(TEST_ROOT, '.skillet-etag', String(Math.random()), 'etag.json');
    await mkdir(pinDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(TEST_ROOT, { recursive: true });
  });

  it('pure rotation: unchanged until accepted, then re-verified and rewritten', async () => {
    const oldKey = generateAuthorKey();
    const newKey = generateAuthorKey();
    const bundle = bundleOf('same body across rotation');
    const hash = canonicalContentHash(bundle);
    const reg = buildFakeRegistry(bundle, newKey);

    await writeBundleToSkillStore('@taylor/festival-ops', bundle);
    const entry = makeEntry({
      hash,
      authorKeyId: oldKey.keyId,
      authorPubBase64: pubB64(oldKey),
      signature: signEnvelope(hash, oldKey),
    });
    await upsertSkill(entry);

    // Control: same content hash short-circuits to `unchanged` — the rotated
    // envelope is never inspected. This is the masked state the flag exists for.
    const before = await readState();
    const control = await pullRegistryUpdates(before, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });
    expect(control[0].status).toBe('unchanged');
    expect(before.skills['@taylor/festival-ops'].authorKeyId).toBe(oldKey.keyId);

    // Accept the rotation: re-pin + flag + etag drop.
    const { flagged } = await acceptAuthorKeyRotationWithInvalidation(
      'taylor',
      { key_id: newKey.keyId, pub: pubB64(newKey) },
      pinDir,
      { etagCachePath: etagPath },
    );
    expect(flagged).toEqual(['@taylor/festival-ops']);

    const state = await readState();
    expect(state.skills['@taylor/festival-ops'].needsKeyReverify).toBe(true);

    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });
    expect(outcomes[0].status).toBe('updated');

    const after = await readState();
    const rewritten = after.skills['@taylor/festival-ops'];
    expect(rewritten.authorKeyId).toBe(newKey.keyId);
    expect(rewritten.signature?.key_id).toBe(newKey.keyId);
    expect(rewritten.needsKeyReverify).toBeUndefined();
  });

  it('flags and drops etags for the accepted handle only; union etags clear wholesale', async () => {
    const key = generateAuthorKey();
    const taylor = makeEntry({ authorKeyId: key.keyId });
    const other = makeEntry({
      slug: '@maya/notes',
      owner: 'maya',
      name: 'notes',
      authorKeyId: key.keyId,
    });
    await upsertSkill(taylor);
    await upsertSkill(other);
    await mkdir(join(etagPath, '..'), { recursive: true });
    await writeFile(
      etagPath,
      JSON.stringify({
        version: 1,
        entries: { '@taylor/festival-ops': '"a"', '@maya/notes': '"b"' },
        union: { 'https://registry.example.com|dev|device': '"u"' },
      }),
    );

    const { flagged } = await invalidateAfterKeyRotation('taylor', { etagCachePath: etagPath });
    expect(flagged).toEqual(['@taylor/festival-ops']);

    const state = await readState();
    expect(state.skills['@taylor/festival-ops'].needsKeyReverify).toBe(true);
    expect(state.skills['@maya/notes'].needsKeyReverify).toBeUndefined();

    const cache = JSON.parse(await readFile(etagPath, 'utf8')) as {
      entries: Record<string, string>;
      union: Record<string, string>;
    };
    expect(cache.entries['@taylor/festival-ops']).toBeUndefined();
    expect(cache.entries['@maya/notes']).toBe('"b"');
    expect(cache.union).toEqual({});
  });

  it('fails loudly when a flagged skill is still served with a non-pinned key', async () => {
    const servedKey = generateAuthorKey();
    const acceptedKey = generateAuthorKey();
    const bundle = bundleOf('same body across rotation');
    const hash = canonicalContentHash(bundle);
    const reg = buildFakeRegistry(bundle, servedKey);

    await writeBundleToSkillStore('@taylor/festival-ops', bundle);
    await upsertSkill(
      makeEntry({ hash, authorKeyId: servedKey.keyId, authorPubBase64: pubB64(servedKey) }),
    );

    // User accepted a rotation to acceptedKey, but the registry serves
    // servedKey — verification must fail, and the flag must survive so the
    // next sync retries instead of silently passing.
    await acceptAuthorKeyRotationWithInvalidation(
      'taylor',
      { key_id: acceptedKey.keyId, pub: pubB64(acceptedKey) },
      pinDir,
      { etagCachePath: etagPath },
    );

    const state = await readState();
    const outcomes = await pullRegistryUpdates(state, {
      interactive: true,
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });
    expect(outcomes[0].status).toBe('failed');
    expect(outcomes[0].reason).toMatch(/key_id_mismatch|author_key_changed/);

    const after = await readState();
    expect(after.skills['@taylor/festival-ops'].needsKeyReverify).toBe(true);
  });

  it('union path: a flagged entry bypasses the hash-equality short-circuit and re-verifies', async () => {
    const newKey = generateAuthorKey();
    const bundle = bundleOf('same body across rotation');
    const hash = canonicalContentHash(bundle);
    const reg = buildFakeRegistry(bundle, newKey);

    await writeBundleToSkillStore('@taylor/festival-ops', bundle);
    const oldKey = generateAuthorKey();
    await upsertSkill(
      makeEntry({
        hash,
        sourceKit: '@taylor/kit',
        authorKeyId: oldKey.keyId,
        authorPubBase64: pubB64(oldKey),
        signature: signEnvelope(hash, oldKey),
      }),
    );
    await invalidateAfterKeyRotation('taylor', { etagCachePath: etagPath });

    const state = await readState();
    const res = await pullFromUnionManifest(state, {
      registryUrl: 'https://registry.example.com',
      token: 'skillet_d_test',
      pinDir,
      etagCachePath: etagPath,
      fetchImpl: reg.fetchImpl,
    });
    expect(res.outcomes[0].status).toBe('updated');

    const after = await readState();
    expect(after.skills['@taylor/festival-ops'].authorKeyId).toBe(newKey.keyId);
    expect(after.skills['@taylor/festival-ops'].needsKeyReverify).toBeUndefined();
  });
});
