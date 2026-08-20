/**
 * End-to-end share-loop test — runs under node:test, NOT
 * vitest, because @skillet/registry imports node:sqlite (an experimental Node
 * built-in) and vite's transformer mangles the `node:` prefix when it walks
 * workspace packages. node:test stays on Node's loader the whole way through.
 *
 * Flow:
 *
 *   add @alice/festival-ops  →  publish v2  →  consumer sync holds the update
 *   (pendingReview, no mid-sync diff)  →  approve  →  materialize  →  on-disk
 *   bytes match v2 bundle
 *
 * No port binding: the test injects a `fetchImpl` that translates fetch
 * calls into `app.inject(...)` calls, so there's no listen/teardown race.
 * Everything else — signing, TOFU pinning, canonical hashing, graded diff,
 * approval lock, adapter materialize — is the real production path.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable, Writable } from 'node:stream';
import {
  generateKeyPairSync,
  randomBytes,
  sign as edSign,
  type KeyObject,
} from 'node:crypto';

// Redirect HOME / SKILLET_DIR / XDG_CONFIG_HOME BEFORE importing @skillet/core, so
// the allowlist + skill store + pin dir + etag cache + approval lock all
// live under TEST_ROOT.
const TEST_ROOT = join(
  tmpdir(),
  `skillet-share-loop-e2e-${randomBytes(4).toString('hex')}`,
);
process.env['HOME'] = TEST_ROOT;
process.env['SKILLET_DIR'] = join(TEST_ROOT, '.skillet');
process.env['XDG_CONFIG_HOME'] = join(TEST_ROOT, '.config');
if (process.platform === 'win32') {
  process.env['USERPROFILE'] = TEST_ROOT;
}
delete process.env['SKILLET_TOKEN'];
delete process.env['CI'];

const { canonicalContentHash } = await import('@skillet/protocol');
const { add, sync, readState, upsertSkill, approveUpdate } = await import('@skillet/core');
const { freshMysqlE2eServer, isCoreMysqlE2eReachable } = await import('./mysql-e2e-server.js');
import type { Adapter } from '@skillet/core';
import type { BundleFiles } from '@skillet/protocol';

const mysqlOk = await isCoreMysqlE2eReachable();

// ---------------------------------------------------------------------------
// Author-side helpers (mirrors packages/registry/test/registry.test.ts).
// ---------------------------------------------------------------------------

interface AuthorKey {
  publicKey: KeyObject;
  privateKey: KeyObject;
  pubB64: string;
  keyId: string;
}

function generateAuthorKey(): AuthorKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' }) as { x: string };
  const pub = Buffer.from(jwk.x, 'base64url');
  return {
    publicKey,
    privateKey,
    pubB64: pub.toString('base64'),
    keyId: pub.toString('hex'),
  };
}

function signEnvelopeFor(contentHash: string, key: AuthorKey) {
  const sig = edSign(null, Buffer.from(contentHash, 'utf8'), key.privateKey);
  return { alg: 'ed25519' as const, key_id: key.keyId, sig: sig.toString('base64') };
}

function bundleFiles(text: string): BundleFiles {
  return {
    'SKILL.md': {
      enc: 'utf8',
      data:
        `---\nname: festival-ops\ndescription: production runbook for festivals\n---\n${text}\n`,
    },
  };
}

function makeTestAdapter(targetRoot: string): Adapter {
  return {
    name: 'test-adapter',
    kind: 'global',
    targetDir: targetRoot,
    targetSkillDir: (slug: string, opts?: { owner?: string | null }) => {
      const dirName = opts?.owner ? `${opts.owner}--${slug}` : slug;
      return join(targetRoot, dirName);
    },
    async detect() {
      return true;
    },
    async materialize(slug, bundle, opts?: { owner?: string | null }) {
      const dirName = opts?.owner ? `${opts.owner}--${slug}` : slug;
      const dir = join(targetRoot, dirName);
      await mkdir(dir, { recursive: true });
      const out: string[] = [];
      for (const [path, bytes] of bundle) {
        const dest = join(dir, path);
        await mkdir(join(dest, '..'), { recursive: true });
        await writeFile(dest, Buffer.from(bytes));
        out.push(dest);
      }
      return out;
    },
  } as unknown as Adapter;
}

// ---------------------------------------------------------------------------
// Suite. concurrency: false → state mutations carry between tests.
// ---------------------------------------------------------------------------

describe('share-loop end-to-end', { concurrency: false, skip: !mysqlOk }, () => {
  let server: Awaited<ReturnType<typeof freshMysqlE2eServer>>;
  let alice: AuthorKey;
  let aliceToken: string;
  let fetchImpl: typeof fetch;
  const adapterRoot = join(TEST_ROOT, '.claude', 'skills');

  before(async () => {
    await mkdir(adapterRoot, { recursive: true });

    server = await freshMysqlE2eServer({ scanSync: true });

    alice = generateAuthorKey();
    const sess = await server.app.inject({
      method: 'POST',
      url: '/api/v1/sessions/dev',
      payload: { handle: 'alice', two_factor: true },
    });
    assert.equal(sess.statusCode, 201, `dev-session: ${sess.body}`);
    aliceToken = (sess.json() as { session_token: string }).session_token;

    const claim = await server.app.inject({
      method: 'POST',
      url: '/api/v1/claim',
      payload: {
        handle: 'alice',
        public_key: alice.pubB64,
        key_id: alice.keyId,
      },
      headers: { authorization: `Bearer ${aliceToken}` },
    });
    assert.equal(claim.statusCode, 201, `claim: ${claim.body}`);

    // Bridge fetch → app.inject so we never bind a port. Returns a Response.
    fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers: Record<string, string> = {};
      const inHeaders = init?.headers as Record<string, string> | undefined;
      if (inHeaders) for (const [k, v] of Object.entries(inHeaders)) headers[k] = v;
      const res = await server.app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST',
        url: url.pathname + url.search,
        headers,
        ...(init?.body
          ? {
              payload:
                typeof init.body === 'string'
                  ? init.body
                  : Buffer.from(init.body as ArrayBuffer),
            }
          : {}),
      });
      const nullBodyStatuses = new Set([101, 204, 205, 304]);
      return new Response(nullBodyStatuses.has(res.statusCode) ? null : res.body, {
        status: res.statusCode,
        headers: res.headers as HeadersInit,
      });
    }) as unknown as typeof fetch;
  });

  after(async () => {
    await server.app.close();
    server.db.close();
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  async function alicePublishes(text: string, baseHash?: string): Promise<string> {
    const files = bundleFiles(text);
    const decoded = new Map(
      Object.entries(files).map(([p, f]) => [p, Buffer.from(f.data, 'utf8') as Uint8Array]),
    );
    const contentHash = canonicalContentHash(decoded);
    const envelope = signEnvelopeFor(contentHash, alice);
    const res = await server.app.inject({
      method: 'POST',
      url: '/api/v1/skills',
      headers: { authorization: `Bearer ${aliceToken}` },
      payload: {
        author: 'alice',
        slug: 'festival-ops',
        files,
        // The server stores `skills.latest_hash` in canonical `sha256:<hex>`
        // form, so the publish concurrency guard compares prefix-included.
        ...(baseHash ? { base_hash: `sha256:${baseHash}` } : {}),
        signature: envelope,
        // Publish publicly so consumer `skillet add` can fetch without auth.
        visibility: 'public',
      },
    });
    assert.equal(res.statusCode, 201, `publish: ${res.body}`);
    return contentHash.slice('sha256:'.length);
  }

  it('add → publish v2 → sync holds update for review → approve → materialize', async () => {
    const v1Hash = await alicePublishes('v1: red wristbands');

    const addResult = await add('@alice/festival-ops', {
      registryUrl: 'https://test-registry.invalid',
      fetchImpl,
    });
    assert.equal(addResult.noop, false);
    assert.equal(addResult.newlyPinned, true);
    assert.equal(addResult.entry.source, 'registry');
    assert.equal(addResult.entry.hash, `sha256:${v1Hash}`);
    assert.equal(addResult.entry.authorKeyId, alice.keyId);
    assert.equal(addResult.entry.authorPubBase64, alice.pubB64);

    // Kit-exclusive sync: mark the skill as belonging to a kit before materialize.
    await upsertSkill({ ...addResult.entry, sourceKit: '@alice/share-kit' });

    const adapter = makeTestAdapter(adapterRoot);
    // Materialize v1 so the v2 pull surfaces a true on-disk update diff.
    await sync(TEST_ROOT, [adapter], {
      fetchImpl,
      pullMode: 'interactive',
      approvePre: true,
    });

    const v2Hash = await alicePublishes(
      'v2: green wristbands; updated risk register',
      v1Hash,
    );
    assert.notEqual(v2Hash, v1Hash);

    // Interactive sync HOLDS the update — no diff walls, no prompt mid-sync.
    // The v1 bytes stay on disk and the skill lands in pendingReview; review
    // and approval live in `skillet pending` / `skillet approve`.
    const promptedDiffs: string[] = [];
    const output = new Writable({
      write(chunk, _enc, cb) {
        const s = chunk.toString();
        if (s.includes('---') || s.includes('+++') || s.includes('@@')) {
          promptedDiffs.push(s);
        }
        cb();
      },
    }) as unknown as NodeJS.WriteStream;
    (output as unknown as { isTTY: boolean }).isTTY = true;
    const input = Readable.from([]) as unknown as NodeJS.ReadableStream;

    const syncResult = await sync(TEST_ROOT, [adapter], {
      output: output as unknown as NodeJS.WritableStream,
      input,
      fetchImpl,
      pullMode: 'interactive',
    });

    const pullOutcome = syncResult.pull.find(
      (p) => p.slug === '@alice/festival-ops',
    );
    assert.equal(pullOutcome?.status, 'updated');
    assert.equal(pullOutcome?.newHash, `sha256:${v2Hash}`);

    assert.deepEqual(syncResult.failed, []);
    assert.equal(syncResult.materialized.length, 0, 'held update must not materialize');
    assert.equal(syncResult.pendingReview.length, 1, 'held update is summarized for review');
    assert.equal(syncResult.pendingReview[0].slug, '@alice/festival-ops');
    assert.equal(promptedDiffs.length, 0, 'no diff wall reaches the terminal mid-sync');

    const held = await readFile(
      join(adapterRoot, 'alice--festival-ops', 'SKILL.md'),
      'utf8',
    );
    assert.match(held, /red wristbands/);

    // Approve (the `skillet approve` path), then sync materializes v2.
    const afterHold = await readState();
    await approveUpdate('@alice/festival-ops', afterHold.skills['@alice/festival-ops'].version, {});
    const syncResult2 = await sync(TEST_ROOT, [adapter], {
      fetchImpl,
      pullMode: 'interactive',
    });
    assert.deepEqual(syncResult2.failed, []);
    assert.ok(syncResult2.materialized.length > 0, 'approved update materializes');

    const materialized = await readFile(
      join(adapterRoot, 'alice--festival-ops', 'SKILL.md'),
      'utf8',
    );
    assert.match(materialized, /green wristbands/);

    const state = await readState();
    assert.equal(state.skills['@alice/festival-ops'].hash, `sha256:${v2Hash}`);
  });

  it('headless sync does NOT pull updates', async () => {
    const state = await readState();
    const beforeHash = state.skills['@alice/festival-ops'].hash;
    const v3Hash = await alicePublishes(
      'v3: blue wristbands; SecurityEngineer review notes',
      beforeHash.slice('sha256:'.length),
    );

    const output = new Writable({
      write: (_c, _e, cb) => cb(),
    }) as unknown as NodeJS.WriteStream;
    const input = Readable.from(['']) as unknown as NodeJS.ReadableStream;
    const adapter = makeTestAdapter(adapterRoot);

    const syncResult = await sync(TEST_ROOT, [adapter], {
      output: output as unknown as NodeJS.WritableStream,
      input,
      fetchImpl,
      pullMode: 'unattended',
    });

    const pullOutcome = syncResult.pull.find(
      (p) => p.slug === '@alice/festival-ops',
    );
    assert.equal(pullOutcome?.status, 'skipped-unattended');

    const after = await readState();
    assert.notEqual(after.skills['@alice/festival-ops'].hash, `sha256:${v3Hash}`);

    const onDisk = await readFile(
      join(adapterRoot, 'alice--festival-ops', 'SKILL.md'),
      'utf8',
    );
    assert.match(onDisk, /green wristbands/);
    assert.doesNotMatch(onDisk, /blue wristbands/);
  });

  it('add is idempotent when local state already matches latest_hash', async () => {
    // Test 2 left the kit at v2 while the registry advanced to v3. Pull v3
    // first to land state == registry, then a re-add MUST short-circuit to
    // a noop without re-downloading or re-verifying.
    const output = new Writable({
      write: (_c, _e, cb) => cb(),
    }) as unknown as NodeJS.WriteStream;
    (output as unknown as { isTTY: boolean }).isTTY = true;
    const input = Readable.from(['y\n']) as unknown as NodeJS.ReadableStream;
    const adapter = makeTestAdapter(adapterRoot);
    await sync(TEST_ROOT, [adapter], {
      output: output as unknown as NodeJS.WritableStream,
      input,
      fetchImpl,
      pullMode: 'interactive',
    });

    const result = await add('@alice/festival-ops', {
      registryUrl: 'https://test-registry.invalid',
      fetchImpl,
    });
    assert.equal(result.noop, true);
  });
});
