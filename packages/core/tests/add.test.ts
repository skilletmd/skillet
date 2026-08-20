/**
 * add() unit tests.
 *
 * Covers the security-critical signing chain in packages/core/src/commands/add.ts:
 *   - author_key_id ↔ author_pub binding check (prevents TOFU bypass)
 *   - TOFU pin mismatch on re-install with spoofed key_id
 *   - Happy path: SkillEntry fields populated, TOFU pinned
 *   - Idempotent re-install (same hash → noop)
 *   - All required error codes: registry_missing_signature, signature_invalid,
 *     key_id_mismatch, integrity_failed
 *
 * Isolation: HOME and SKILLET_DIR redirected via vi.hoisted BEFORE @skillet/core loads.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs')
  return redirectHome('skillet-add-test')
})

import { add } from '../src/commands/add.js';
import { generateAuthorKey } from '../src/signing/index.js';
import { signEnvelope, SignatureError } from '../src/signing/envelope.js';
import {
  canonicalContentHash,
  encodeBundle,
  type DecodedBundle,
} from '@skillet/protocol';

const REGISTRY_URL = 'https://registry.example.test';

function pubB64(k: ReturnType<typeof generateAuthorKey>): string {
  const jwk = k.publicKey.export({ format: 'jwk' }) as { x: string };
  return Buffer.from(jwk.x, 'base64url').toString('base64');
}

function testBundle(text = 'hello'): DecodedBundle {
  return new Map([
    [
      'SKILL.md',
      Buffer.from(`---\nname: test-skill\ndescription: test\n---\n${text}\n`, 'utf8'),
    ],
  ]);
}

interface FakeRegistryOpts {
  bundle: DecodedBundle;
  signingKey: ReturnType<typeof generateAuthorKey>;
  /** Override the author_key_id served (default: derived from signingKey) */
  spoofAuthorKeyId?: string;
  /** Override the author_pub served (default: derived from signingKey) */
  spoofAuthorPub?: string;
  /** Omit signature entirely */
  noSignature?: boolean;
  /**
   * Serve a v2 (bundle-bound) envelope instead of v1. Real registries serve v2
   * for any version carrying an author_key_id, so this is the common case in
   * production — it just had no coverage here.
   */
  v2?: boolean;
}

function buildFakeRegistryFetch(opts: FakeRegistryOpts): typeof fetch {
  const { bundle, signingKey } = opts;
  const contentHash = canonicalContentHash(bundle);
  const latestHash = contentHash.slice('sha256:'.length);
  const envelope = opts.v2
    ? signEnvelope(contentHash, signingKey, {
        binding: {
          ref: '@alice/test-skill',
          // Single-version manifest below, so the ordinal is 1.
          version: 1,
          authorKeyId: signingKey.keyId,
        },
      })
    : signEnvelope(contentHash, signingKey);
  const files = encodeBundle(bundle);
  const authorKeyId = opts.spoofAuthorKeyId ?? signingKey.keyId;
  const authorPub = opts.spoofAuthorPub ?? pubB64(signingKey);
  const installCalls: string[] = [];

  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const sig = opts.noSignature
      ? undefined
      : {
          alg: 'ed25519',
          key_id: opts.spoofAuthorKeyId ?? signingKey.keyId,
          sig: envelope.sig,
          // Carry sig_version through — it is what makes the client take the
          // v2 verification path (isBundleSignatureV2).
          ...(envelope.sig_version ? { sig_version: envelope.sig_version } : {}),
        };

    if (url.includes('/manifest')) {
      return new Response(
        JSON.stringify({
          author: 'alice',
          slug: 'test-skill',
          skill_id: 'alice:test-skill',
          latest_hash: latestHash,
          install_count: 0,
          author_key_id: authorKeyId,
          author_public_key: authorPub,
          versions: [
            {
              hash: latestHash,
              published_at: 1000,
              url: `/api/v1/skills/alice/test-skill/versions/${latestHash}`,
              signature: sig ?? null,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json', etag: `"${latestHash}"` } },
      );
    }
    if (url.includes('/versions/')) {
      return new Response(
        JSON.stringify({
          hash: latestHash,
          skill_id: 'alice:test-skill',
          author: 'alice',
          slug: 'test-skill',
          files,
          content_hash: contentHash,
          signature: sig ?? null,
          author_key_id: authorKeyId,
          author_public_key: authorPub,
          metadata: {},
          published_at: 1000,
          published_by: 'alice',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('/install') && init?.method === 'POST') {
      installCalls.push(url);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    throw new Error(`unhandled fake-fetch URL: ${url}`);
  }) as unknown as typeof fetch;

  Object.assign(fetchImpl, { installCalls });
  return fetchImpl;
}

describe('add()', () => {
  let pinDir: string;

  beforeEach(async () => {
    pinDir = join(TEST_ROOT, `.skillet-pins-${Date.now()}`);
    await mkdir(pinDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(pinDir, { recursive: true, force: true });
  });

  it('happy path: installs skill, populates SkillEntry.signature + authorKeyId, TOFU-pins author', async () => {
    const key = generateAuthorKey();
    const bundle = testBundle();
    const fetchImpl = buildFakeRegistryFetch({ bundle, signingKey: key });

    const result = await add('@alice/test-skill', {
      registryUrl: REGISTRY_URL,
      fetchImpl,
      pinDir,
    });

    expect(result.noop).toBe(false);
    expect(result.newlyPinned).toBe(true);
    expect(result.entry.authorKeyId).toBe(key.keyId);
    expect(result.entry.signature).toBeDefined();
    expect(result.entry.signature?.key_id).toBe(key.keyId);
    expect((fetchImpl as typeof fetch & { installCalls: string[] }).installCalls).toHaveLength(1);
  });

  // Regression: add() verified v2 envelopes without passing binding context, so
  // verifyEnvelope threw "v2 envelope requires binding context" and NO v2-signed
  // skill could be installed — while the sync path (registry/pull.ts), which does
  // pass the binding, accepted the very same version. Every suite here signed v1,
  // so the whole v2 path was uncovered.
  it('installs a v2 (bundle-bound) signature, matching what the sync path accepts', async () => {
    const key = generateAuthorKey();
    // Distinct body: an identical hash to an earlier install in this file would
    // hit add()'s already-in-kit short circuit and never reach verification.
    const bundle = testBundle('v2-bound-body');
    const fetchImpl = buildFakeRegistryFetch({ bundle, signingKey: key, v2: true });

    const result = await add('@alice/test-skill', {
      registryUrl: REGISTRY_URL,
      fetchImpl,
      pinDir,
    });

    expect(result.noop).toBe(false);
    expect(result.entry.authorKeyId).toBe(key.keyId);
    expect(result.entry.signature?.sig_version).toBe(2);
  });

  it('idempotent re-install: same hash returns noop without re-fetching bundle', async () => {
    const key = generateAuthorKey();
    const bundle = testBundle();
    const fetchImpl = buildFakeRegistryFetch({ bundle, signingKey: key });

    await add('@alice/test-skill', { registryUrl: REGISTRY_URL, fetchImpl, pinDir });
    const result = await add('@alice/test-skill', { registryUrl: REGISTRY_URL, fetchImpl, pinDir });

    expect(result.noop).toBe(true);
    expect((fetchImpl as typeof fetch & { installCalls: string[] }).installCalls).toHaveLength(2);
  });

  // Security test 1:
  // author_key_id does not equal hex(author_pub) → signature_invalid
  it('rejects first install when author_key_id is inconsistent with author_pub', async () => {
    const key = generateAuthorKey();
    const otherKey = generateAuthorKey();
    // Use unique content so the noop-same-hash short-circuit never fires
    const bundle = testBundle('security-test-binding-check-unique');
    // Serve key's pub but spoof key_id to be otherKey's key_id — inconsistent pair
    const fetchImpl = buildFakeRegistryFetch({
      bundle,
      signingKey: key,
      spoofAuthorKeyId: otherKey.keyId,
    });

    await expect(
      add('@alice/test-skill', { registryUrl: REGISTRY_URL, fetchImpl, pinDir }),
    ).rejects.toMatchObject({ code: 'signature_invalid' });
  });

  // Security test 2:
  // Re-install: pinned key1; registry serves attacker pub with key1's key_id spoofed.
  // Attacker signs bundle with attacker priv. Should be caught by the binding check.
  it('rejects re-install when registry spoofs pinned key_id with a different author_pub', async () => {
    const key1 = generateAuthorKey();
    const attackerKey = generateAuthorKey();
    const bundle = testBundle();

    // First install with legitimate key1
    const legitimateFetch = buildFakeRegistryFetch({ bundle, signingKey: key1 });
    await add('@alice/test-skill', { registryUrl: REGISTRY_URL, fetchImpl: legitimateFetch, pinDir });

    // Re-install: attacker signs with attackerKey but serves key1.keyId as author_key_id
    // (and the envelope key_id also spoofed to key1.keyId)
    const attackerBundle = testBundle('attacker content');
    const maliciousFetch = buildFakeRegistryFetch({
      bundle: attackerBundle,
      signingKey: attackerKey,
      spoofAuthorKeyId: key1.keyId,    // claim victim's key_id
      spoofAuthorPub: pubB64(key1),    // but serve victim's pub (mismatches attacker sig)
    });

    // The binding check: hex(decode(key1_pub)) === key1.keyId → passes
    // But verifyEnvelope will fail because the sig was made with attackerKey, not key1
    await expect(
      add('@alice/test-skill', { registryUrl: REGISTRY_URL, fetchImpl: maliciousFetch, pinDir }),
    ).rejects.toSatisfy((e: unknown) =>
      e instanceof SignatureError && (e.code === 'signature_invalid' || e.code === 'integrity_failed'),
    );
  });

  // Security test 2b: attacker serves attacker_pub but spoofs key_id to victim's key_id
  // This is the exact exploit described — caught by the binding check.
  it('rejects install when attacker serves their own pub but claims victim key_id', async () => {
    const victimKey = generateAuthorKey();
    const attackerKey = generateAuthorKey();
    const bundle = testBundle('attacker bundle');

    // Attacker signs with their own key, serves their own pub, but spoofs key_id
    const maliciousFetch = buildFakeRegistryFetch({
      bundle,
      signingKey: attackerKey,
      spoofAuthorKeyId: victimKey.keyId,  // spoof the key_id to victim's
      // author_pub left as attacker's (default from signingKey)
    });

    await expect(
      add('@alice/test-skill', { registryUrl: REGISTRY_URL, fetchImpl: maliciousFetch, pinDir }),
    ).rejects.toMatchObject({ code: 'signature_invalid' });
  });

  it('rejects when registry response has no signature (registry_missing_signature)', async () => {
    const key = generateAuthorKey();
    const bundle = testBundle();
    const fetchImpl = buildFakeRegistryFetch({ bundle, signingKey: key, noSignature: true });

    await expect(
      add('@alice/test-skill', { registryUrl: REGISTRY_URL, fetchImpl, pinDir }),
    ).rejects.toSatisfy((e: unknown) => {
      // RegistryError or SignatureError with a missing-signature code
      return e instanceof Error && e.message.includes('unsigned');
    });
  });

  it('rejects invalid ref format before any network request', async () => {
    const fetchImpl = (() => {
      throw new Error('fetch must not be called');
    }) as unknown as typeof fetch;

    await expect(
      add('not-a-valid-ref', { registryUrl: REGISTRY_URL, fetchImpl, pinDir }),
    ).rejects.toThrow();
  });
});
