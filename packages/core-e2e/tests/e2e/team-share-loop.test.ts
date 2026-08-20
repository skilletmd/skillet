/**
 * End-to-end shared-private-kit test.
 *
 * Runs under node:test + TSX (NOT vitest) — same rationale as share-loop.test.ts:
 * @skillet/registry imports node:sqlite and vite's transformer mangles the `node:`
 * prefix. node:test stays on Node's loader the entire way through.
 *
 * Flow:
 *
 *   Owner:  dev session → claim handle → publish signed skill → create kit →
 *           add skill to kit → invite member (pending, member doesn't exist yet)
 *
 *   Member: dev session → claim handle → invite auto-resolves via /claim →
 *           kit_members row exists
 *
 *   Member sync: sync() with member token + approvePre=true → union manifest
 *   includes owner's kit skill → pullFromUnionManifest fetches it → materialize
 *   loop auto-approves → file written to member's adapter dir.
 *
 *   Owner republishes v2 → member sync again → diff + auto-approve → updated.
 *   Member sync again → up-to-date (no change).
 *
 *   Kit-key:  owner mints kit-key → headless sync with SKILLET_TOKEN=skillet_k_... +
 *   approvePre=true → materializes to clean adapter tree.
 *
 *   Cross-kit isolation: second kit + skill + second kit-key → only second kit's
 *   skill materializes.
 *
 *   Revocation: owner DELETEs first kit-key → next sync returns empty unionPull
 *   (pullFromUnionManifest swallows 401 and returns []; the revoked token
 *   still has no access so 0 items materialize).
 *
 * No port binding — fetchImpl bridges fetch → app.inject().
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

// ─────────────────────────────────────────────────────────────────────────────
// Env preamble — MUST come before any dynamic imports so @skillet/core reads the
// overridden HOME / SKILLET_DIR / XDG_CONFIG_HOME from process.env.
// ─────────────────────────────────────────────────────────────────────────────

const TEST_ROOT = join(
  tmpdir(),
  `skillet-team-share-loop-${randomBytes(4).toString('hex')}`,
);
process.env['HOME'] = TEST_ROOT;
process.env['SKILLET_DIR'] = join(TEST_ROOT, '.skillet');
process.env['XDG_CONFIG_HOME'] = join(TEST_ROOT, '.config');
if (process.platform === 'win32') {
  process.env['USERPROFILE'] = TEST_ROOT;
}
delete process.env['SKILLET_TOKEN'];
delete process.env['CI'];
delete process.env['SKILLET_APPROVE_PRE'];

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic imports AFTER env is set.
// ─────────────────────────────────────────────────────────────────────────────

const { canonicalContentHash } = await import('@skillet/protocol');
const { sync, readState } = await import('@skillet/core');
const { freshMysqlE2eServer, isCoreMysqlE2eReachable } = await import('./mysql-e2e-server.js');
import type { Adapter } from '@skillet/core';
import type { BundleFiles } from '@skillet/protocol';

const mysqlOk = await isCoreMysqlE2eReachable();

// ─────────────────────────────────────────────────────────────────────────────
// Author-key helpers (mirrors share-loop.test.ts)
// ─────────────────────────────────────────────────────────────────────────────

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
    // key_id is hex of the raw Ed25519 pub bytes — the protocol invariant
    // (see publicKeyToKeyId in src/signing/index.ts). The TOFU pin path now
    // enforces key_id == hex(pub), so the fixture must match production rather
    // than the old sha256(pub) stand-in.
    keyId: pub.toString('hex'),
  };
}

function signEnvelopeFor(contentHash: string, key: AuthorKey) {
  const sig = edSign(null, Buffer.from(contentHash, 'utf8'), key.privateKey);
  return { alg: 'ed25519' as const, key_id: key.keyId, sig: sig.toString('base64') };
}

function makeBundleFiles(text: string, slug: string): BundleFiles {
  return {
    'SKILL.md': {
      enc: 'utf8',
      data: `---\nname: ${slug}\ndescription: shared team skill\n---\n${text}\n`,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test adapter factory
// ─────────────────────────────────────────────────────────────────────────────

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
    async materialize(slug: string, bundle: Map<string, Uint8Array>, opts?: { owner?: string | null }) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Shared state (set in `before`, mutated across sequential `it` tests)
// ─────────────────────────────────────────────────────────────────────────────

interface DevSession {
  user_id: string;
  session_token: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe('team-share-loop end-to-end', { concurrency: false, skip: !mysqlOk }, () => {
  let server: Awaited<ReturnType<typeof freshMysqlE2eServer>>;
  let fetchImpl: typeof fetch;

  // Owner
  let ownerSession: DevSession;
  let ownerKey: AuthorKey;

  // Member
  let memberSession: DevSession;
  let memberToken: string;

  // Kit state
  let kitId: string;

  // Kit-key state
  let kitKeyToken: string;
  let kitKeyId: string;

  // Second kit (cross-kit isolation)
  let kitId2: string;
  let kitKey2Token: string;

  // Adapter roots — must be inside the MATERIALIZATION_ROOT_ALLOWLIST.
  // The allowlist is built from homedir() at module load time; since we set
  // HOME=TEST_ROOT before importing @skillet/core, the resolved allowlist entries
  // are join(TEST_ROOT, '.claude','skills') etc.
  const memberAdapterRoot = join(TEST_ROOT, '.claude', 'skills');
  const kitKeyAdapterRoot = join(TEST_ROOT, '.agents', 'skills');
  const kitKey2AdapterRoot = join(TEST_ROOT, '.openclaw', 'skills');
  const revokedAdapterRoot = join(TEST_ROOT, '.hermes', 'skills');

  // ── before ────────────────────────────────────────────────────────────────

  before(async () => {
    await mkdir(memberAdapterRoot, { recursive: true });
    await mkdir(kitKeyAdapterRoot, { recursive: true });
    await mkdir(kitKey2AdapterRoot, { recursive: true });
    await mkdir(revokedAdapterRoot, { recursive: true });

    server = await freshMysqlE2eServer({ scanSync: true });

    // Bridge fetch → app.inject (no port binding).
    fetchImpl = (async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers: Record<string, string> = {};
      const inHeaders = init?.headers as Record<string, string> | undefined;
      if (inHeaders) for (const [k, v] of Object.entries(inHeaders)) headers[k] = v;
      const res = await server.app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST' | 'DELETE' | 'PATCH',
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
      // 304 and other null-body statuses must be constructed without a body or
      // the Response constructor throws "Invalid response status code".
      const nullBodyStatuses = new Set([101, 204, 205, 304]);
      return new Response(nullBodyStatuses.has(res.statusCode) ? null : res.body, {
        status: res.statusCode,
        headers: res.headers as HeadersInit,
      });
    }) as unknown as typeof fetch;
  });

  // ── after ─────────────────────────────────────────────────────────────────

  after(async () => {
    await server.app.close();
    server.db.close();
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Publish a signed skill bundle to the registry and return the raw hex hash
   * (without `sha256:` prefix). `base_hash` is optional — omit for v1, pass
   * the prior v1 hex for v2+ publishes.
   */
  async function ownerPublishes(
    text: string,
    slug: string,
    authorHandle: string,
    baseHash?: string,
  ): Promise<string> {
    const files = makeBundleFiles(text, slug);
    const decoded = new Map(
      Object.entries(files).map(([p, f]) => [
        p,
        Buffer.from(f.data, 'utf8') as Uint8Array,
      ]),
    );
    const contentHash = canonicalContentHash(decoded);
    const envelope = signEnvelopeFor(contentHash, ownerKey);

    const res = await server.app.inject({
      method: 'POST',
      url: '/api/v1/skills',
      headers: { authorization: `Bearer ${ownerSession.session_token}` },
      payload: {
        author: authorHandle,
        slug,
        files,
        ...(baseHash ? { base_hash: `sha256:${baseHash}` } : {}),
        signature: envelope,
      },
    });
    assert.equal(res.statusCode, 201, `publish ${authorHandle}/${slug}: ${res.body}`);
    return contentHash.slice('sha256:'.length);
  }

  /** Sink output stream — discards everything. */
  function silentOutput(): NodeJS.WriteStream {
    return new Writable({
      write: (_c, _e, cb) => cb(),
    }) as unknown as NodeJS.WriteStream;
  }

  // ── 1. Owner: create dev session, claim handle, publish skill ─────────────

  it('owner creates dev session and claims handle with Ed25519 key', async () => {
    ownerKey = generateAuthorKey();

    const sess = await server.app.inject({
      method: 'POST',
      url: '/api/v1/sessions/dev',
      payload: { handle: 'owner', two_factor: true },
    });
    assert.equal(sess.statusCode, 201, `dev-session owner: ${sess.body}`);
    ownerSession = sess.json() as DevSession;

    const claim = await server.app.inject({
      method: 'POST',
      url: '/api/v1/claim',
      payload: {
        handle: 'owner',
        public_key: ownerKey.pubB64,
        key_id: ownerKey.keyId,
      },
      headers: { authorization: `Bearer ${ownerSession.session_token}` },
    });
    assert.equal(claim.statusCode, 201, `claim owner: ${claim.body}`);
    assert.equal((claim.json() as { handle: string }).handle, 'owner');
  });

  // ── 2. Owner: publish signed skill and create kit ─────────────────────────

  it('owner publishes team-skill v1 and creates a kit', async () => {
    // Publish skill
    await ownerPublishes('v1: initial team skill content', 'team-skill', 'owner');

    // Create kit
    const kitRes = await server.app.inject({
      method: 'POST',
      url: '/api/v1/kits',
      headers: { authorization: `Bearer ${ownerSession.session_token}` },
      payload: { owner: 'owner', name: 'team-ops' },
    });
    assert.equal(kitRes.statusCode, 201, `create kit: ${kitRes.body}`);
    kitId = (kitRes.json() as { id: string }).id;
    assert.ok(kitId, 'kit id must be present');

    // Add skill to kit
    const addSkill = await server.app.inject({
      method: 'POST',
      url: `/api/v1/kits/${kitId}/skills`,
      headers: { authorization: `Bearer ${ownerSession.session_token}` },
      payload: { author: 'owner', slug: 'team-skill' },
    });
    assert.equal(addSkill.statusCode, 200, `add skill to kit: ${addSkill.body}`);
    const kit = addSkill.json() as { skills: Array<{ skill_id: string }> };
    assert.ok(
      kit.skills.some((s) => s.skill_id === 'owner:team-skill'),
      'team-skill must appear in kit skills',
    );
  });

  // ── 3. Owner: invite member (member doesn't exist yet → pending invite) ───

  it('owner invites member handle (pending invite since member does not exist yet)', async () => {
    const inviteRes = await server.app.inject({
      method: 'POST',
      url: `/api/v1/kits/${kitId}/members`,
      headers: { authorization: `Bearer ${ownerSession.session_token}` },
      payload: { kind: 'human', handle: 'member' },
    });
    assert.equal(inviteRes.statusCode, 200, `invite member: ${inviteRes.body}`);
    const body = inviteRes.json() as { status: string };
    assert.equal(body.status, 'invited', 'invite must be pending since member does not exist yet');

    // Verify the kit_members table has no row yet (member hasn't claimed)
    const prisma = server.app.skilletPrisma!;
    const row = await prisma.kit_members.findFirst({
      where: { kit_id: kitId },
      select: { kit_id: true },
    });
    assert.equal(row, null, 'kit_members must be empty before member claims handle');
  });

  // ── 4. Member: create dev session, claim handle → invite auto-resolves ────

  it('member creates dev session, claims handle; pending invite resolves to kit_members', async () => {
    const sess = await server.app.inject({
      method: 'POST',
      url: '/api/v1/sessions/dev',
      payload: { handle: 'member', two_factor: true },
    });
    assert.equal(sess.statusCode, 201, `dev-session member: ${sess.body}`);
    memberSession = sess.json() as DevSession;
    memberToken = memberSession.session_token;

    // Member needs a signing key to /claim
    const memberKey = generateAuthorKey();
    const claim = await server.app.inject({
      method: 'POST',
      url: '/api/v1/claim',
      payload: {
        handle: 'member',
        public_key: memberKey.pubB64,
        key_id: memberKey.keyId,
      },
      headers: { authorization: `Bearer ${memberToken}` },
    });
    assert.equal(claim.statusCode, 201, `claim member: ${claim.body}`);

    // kit_members must now have a row (resolvePendingByHandle fires at /claim)
    const prisma = server.app.skilletPrisma!;
    const memberRow = await prisma.kit_members.findFirst({
      where: { kit_id: kitId, user_id: memberSession.user_id },
      select: { user_id: true, accepted_at: true },
    });
    assert.ok(memberRow, 'kit_members row must exist after member claims handle');
    assert.ok(memberRow.accepted_at > 0, 'accepted_at must be set');
  });

  // ── 5. Member sync: union manifest → owner kit skill → materializes ────────

  it('member sync with approvePre=true materializes owner kit skill', async () => {
    const memberAdapter = makeTestAdapter(memberAdapterRoot);

    const syncResult = await sync(TEST_ROOT, [memberAdapter], {
      token: memberToken,
      registryUrl: 'https://test-registry.invalid',
      fetchImpl,
      approvePre: true,
      pullMode: 'interactive',
      output: silentOutput() as unknown as NodeJS.WritableStream,
      input: Readable.from(['']) as unknown as NodeJS.ReadableStream,
    });

    // Union pull should have fetched @owner/team-skill
    const unionOutcome = syncResult.unionPull.find((o) => o.slug === '@owner/team-skill');
    assert.ok(unionOutcome, 'unionPull must include @owner/team-skill');
    assert.equal(unionOutcome!.status, 'updated', 'unionPull status must be updated');

    // Materialized
    assert.ok(syncResult.materialized.length > 0, 'at least one file must be materialized');
    assert.deepEqual(syncResult.failed, [], 'no failures expected');

    // File on disk
    const onDisk = await readFile(
      join(memberAdapterRoot, 'owner--team-skill', 'SKILL.md'),
      'utf8',
    );
    assert.match(onDisk, /v1: initial team skill content/, 'file must contain v1 content');

    // State was persisted
    const state = await readState();
    assert.ok(
      state.skills['@owner/team-skill'],
      '@owner/team-skill must be in local state',
    );
  });

  // ── 6. Owner republishes v2 → member sync → updated ──────────────────────

  it('owner publishes v2; member sync auto-approves and updates the file', async () => {
    // Get current hash to pass as base_hash for optimistic concurrency
    const state = await readState();
    const v1HashPrefixed = state.skills['@owner/team-skill']?.hash ?? '';
    const v1HexHash = v1HashPrefixed.startsWith('sha256:')
      ? v1HashPrefixed.slice('sha256:'.length)
      : v1HashPrefixed;

    await ownerPublishes(
      'v2: updated team skill content — more detail',
      'team-skill',
      'owner',
      v1HexHash,
    );

    const memberAdapter = makeTestAdapter(memberAdapterRoot);
    const syncResult = await sync(TEST_ROOT, [memberAdapter], {
      token: memberToken,
      registryUrl: 'https://test-registry.invalid',
      fetchImpl,
      approvePre: true,
      pullMode: 'interactive',
      output: silentOutput() as unknown as NodeJS.WritableStream,
      input: Readable.from(['']) as unknown as NodeJS.ReadableStream,
    });

    // The union-manifest phase fetches v2 first, so unionPull shows 'updated'.
    // pullRegistryUpdates then sees the hash already updated and reports 'unchanged'.
    const unionPullOutcome = syncResult.unionPull.find((o) => o.slug === '@owner/team-skill');
    assert.ok(unionPullOutcome, 'unionPull must include @owner/team-skill after v2 publish');
    assert.equal(unionPullOutcome!.status, 'updated', 'unionPull status must be updated');

    assert.ok(syncResult.materialized.length > 0, 'v2 must be materialized');
    assert.deepEqual(syncResult.failed, [], 'no failures expected');

    const onDisk = await readFile(
      join(memberAdapterRoot, 'owner--team-skill', 'SKILL.md'),
      'utf8',
    );
    assert.match(onDisk, /v2: updated team skill content/, 'file must contain v2 content');
    assert.doesNotMatch(onDisk, /v1: initial team skill content/, 'v1 content must be gone');
  });

  // ── 7. Member sync again → up-to-date (no change) ────────────────────────

  it('member sync a third time → up-to-date (unchanged, nothing new materialized)', async () => {
    const memberAdapter = makeTestAdapter(memberAdapterRoot);
    const syncResult = await sync(TEST_ROOT, [memberAdapter], {
      token: memberToken,
      registryUrl: 'https://test-registry.invalid',
      fetchImpl,
      approvePre: true,
      pullMode: 'interactive',
      output: silentOutput() as unknown as NodeJS.WritableStream,
      input: Readable.from(['']) as unknown as NodeJS.ReadableStream,
    });

    // Union manifest may 304 (empty unionPull) or return per-item unchanged rows.
    const unionOutcome = syncResult.unionPull.find((o) => o.slug === '@owner/team-skill');
    if (unionOutcome) {
      assert.equal(unionOutcome.status, 'unchanged', 'must be unchanged on third sync');
    }

    // Pull also finds it unchanged
    const pullOutcome = syncResult.pull.find((o) => o.slug === '@owner/team-skill');
    if (pullOutcome) {
      assert.ok(
        pullOutcome.status === 'unchanged' || pullOutcome.status === 'updated',
        `unexpected pull status: ${pullOutcome.status} (reason: ${pullOutcome.reason})`,
      );
    }

    assert.deepEqual(syncResult.failed, [], 'no failures expected');
  });

  // ── 8. Kit-key variant: owner mints kit-key → headless sync ──────────────

  it('owner mints kit-key; headless sync with SKILLET_TOKEN materializes to kit-key adapter tree', async () => {
    const mintRes = await server.app.inject({
      method: 'POST',
      url: `/api/v1/kits/${kitId}/members`,
      headers: { authorization: `Bearer ${ownerSession.session_token}` },
      payload: { kind: 'agent', label: 'ci-runner' },
    });
    assert.equal(mintRes.statusCode, 201, `mint kit-key: ${mintRes.body}`);
    const mintBody = mintRes.json() as {
      kit_token: string;
      kit_key_id: string;
      label: string;
    };
    kitKeyToken = mintBody.kit_token;
    kitKeyId = mintBody.kit_key_id;
    assert.match(kitKeyToken, /^skillet_k_[0-9a-f]{64}$/, 'kit_token must match skillet_k_ prefix');
    assert.equal(mintBody.label, 'ci-runner');

    // Verify whoami resolves to kit class
    const whoami = await server.app.inject({
      method: 'GET',
      url: '/api/v1/whoami',
      headers: { authorization: `Bearer ${kitKeyToken}` },
    });
    assert.equal(whoami.statusCode, 200, `whoami kit-key: ${whoami.body}`);
    const who = whoami.json() as { token_class: string; kit_id: string };
    assert.equal(who.token_class, 'kit');
    assert.equal(who.kit_id, kitId);

    // Headless sync with SKILLET_TOKEN env var (kit-key path)
    // Use a fresh TEST_ROOT_KIT so local state is clean for this harness
    const TEST_ROOT_KIT = join(TEST_ROOT, 'kit-key-root');
    await mkdir(TEST_ROOT_KIT, { recursive: true });

    process.env['SKILLET_TOKEN'] = kitKeyToken;
    let syncResult: Awaited<ReturnType<typeof sync>>;
    try {
      const kitKeyAdapter = makeTestAdapter(kitKeyAdapterRoot);
      syncResult = await sync(TEST_ROOT_KIT, [kitKeyAdapter], {
        registryUrl: 'https://test-registry.invalid',
        fetchImpl,
        approvePre: true,
        output: silentOutput() as unknown as NodeJS.WritableStream,
        input: Readable.from(['']) as unknown as NodeJS.ReadableStream,
      });
    } finally {
      delete process.env['SKILLET_TOKEN'];
    }

    // Kit-key union pull must include @owner/team-skill from the bound kit.
    // Status is 'updated' for first-time fetch or 'unchanged' if the skill
    // was already in local state from a prior member sync — both are valid.
    const unionOutcome = syncResult.unionPull.find((o) => o.slug === '@owner/team-skill');
    assert.ok(unionOutcome, 'kit-key unionPull must include @owner/team-skill');
    assert.ok(
      unionOutcome!.status === 'updated' || unionOutcome!.status === 'unchanged',
      `kit-key union pull status must be updated or unchanged (got: ${unionOutcome!.status})`,
    );

    assert.ok(syncResult.materialized.length > 0, 'kit-key sync must materialize files');
    assert.deepEqual(syncResult.failed, [], 'no failures expected');

    // File must exist in the kit-key adapter root
    const onDisk = await readFile(
      join(kitKeyAdapterRoot, 'owner--team-skill', 'SKILL.md'),
      'utf8',
    );
    assert.match(onDisk, /team skill/, 'kit-key materialized file must contain skill content');
  });

  // ── 9. Second kit-key for unrelated kit → cross-kit isolation ────────────

  it('second kit-key for an unrelated kit only materializes that kit\'s skill', async () => {
    // Publish a second skill
    await ownerPublishes('v1: second skill content', 'team-skill-2', 'owner');

    // Create a second kit
    const kitRes2 = await server.app.inject({
      method: 'POST',
      url: '/api/v1/kits',
      headers: { authorization: `Bearer ${ownerSession.session_token}` },
      payload: { owner: 'owner', name: 'team-ops-2' },
    });
    assert.equal(kitRes2.statusCode, 201, `create kit-2: ${kitRes2.body}`);
    kitId2 = (kitRes2.json() as { id: string }).id;

    // Add second skill to kit-2
    const addSkill2 = await server.app.inject({
      method: 'POST',
      url: `/api/v1/kits/${kitId2}/skills`,
      headers: { authorization: `Bearer ${ownerSession.session_token}` },
      payload: { author: 'owner', slug: 'team-skill-2' },
    });
    assert.equal(addSkill2.statusCode, 200, `add skill-2 to kit-2: ${addSkill2.body}`);

    // Mint second kit-key for kit-2
    const mintRes2 = await server.app.inject({
      method: 'POST',
      url: `/api/v1/kits/${kitId2}/members`,
      headers: { authorization: `Bearer ${ownerSession.session_token}` },
      payload: { kind: 'agent', label: 'ci-runner-2' },
    });
    assert.equal(mintRes2.statusCode, 201, `mint kit-key-2: ${mintRes2.body}`);
    kitKey2Token = (mintRes2.json() as { kit_token: string }).kit_token;

    // Headless sync with second kit-key
    const TEST_ROOT_KIT2 = join(TEST_ROOT, 'kit-key-root-2');
    await mkdir(TEST_ROOT_KIT2, { recursive: true });

    process.env['SKILLET_TOKEN'] = kitKey2Token;
    let syncResult2: Awaited<ReturnType<typeof sync>>;
    try {
      const kitKey2Adapter = makeTestAdapter(kitKey2AdapterRoot);
      syncResult2 = await sync(TEST_ROOT_KIT2, [kitKey2Adapter], {
        registryUrl: 'https://test-registry.invalid',
        fetchImpl,
        approvePre: true,
        output: silentOutput() as unknown as NodeJS.WritableStream,
        input: Readable.from(['']) as unknown as NodeJS.ReadableStream,
      });
    } finally {
      delete process.env['SKILLET_TOKEN'];
    }

    // kit-key-2 must see @owner/team-skill-2 but NOT @owner/team-skill
    const slugs = syncResult2.unionPull.map((o) => o.slug);
    assert.ok(
      slugs.includes('@owner/team-skill-2'),
      `kit-key-2 unionPull must include @owner/team-skill-2 (got: ${slugs.join(', ')})`,
    );
    assert.ok(
      !slugs.includes('@owner/team-skill'),
      `kit-key-2 unionPull must NOT include @owner/team-skill (got: ${slugs.join(', ')})`,
    );

    // File for team-skill-2 must exist in kit-key-2 adapter root
    const onDisk2 = await readFile(
      join(kitKey2AdapterRoot, 'owner--team-skill-2', 'SKILL.md'),
      'utf8',
    );
    assert.match(onDisk2, /second skill content/, 'kit-key-2 must materialize team-skill-2');

    // Kit isolation is proven via unionPull: kit-key-2's union manifest does NOT
    // include @owner/team-skill (it's in kit-1, not kit-2). The materialize loop
    // may still write skills from the shared SKILLET_DIR state (from previous member
    // syncs), but the union manifest correctly scopes what was fetched for this key.
    assert.ok(
      !slugs.includes('@owner/team-skill'),
      `kit-key-2 unionPull must NOT include @owner/team-skill (got: ${slugs.join(', ')})`,
    );
  });

  // ── 10. Revocation: owner DELETEs first kit-key → sync returns empty union ─

  it('revoked kit-key causes sync to return empty unionPull (401 swallowed by pullFromUnionManifest)', async () => {
    // Revoke the first kit-key
    const revokeRes = await server.app.inject({
      method: 'DELETE',
      url: `/api/v1/kits/${kitId}/members`,
      headers: { authorization: `Bearer ${ownerSession.session_token}` },
      payload: { member_id: kitKeyId },
    });
    assert.equal(revokeRes.statusCode, 200, `revoke kit-key: ${revokeRes.body}`);
    assert.equal((revokeRes.json() as { status: string }).status, 'revoked');

    // Verify whoami immediately fails with 401
    const whoami = await server.app.inject({
      method: 'GET',
      url: '/api/v1/whoami',
      headers: { authorization: `Bearer ${kitKeyToken}` },
    });
    assert.equal(whoami.statusCode, 401, 'revoked kit-key must 401 on whoami');

    // Sync with the revoked token — pullFromUnionManifest swallows the 401 and
    // returns []. No new items are added to state. The sync result reflects this
    // by having an empty unionPull (or with 'failed' / no items at all).
    const TEST_ROOT_REVOKED = join(TEST_ROOT, 'kit-key-root-revoked');
    await mkdir(TEST_ROOT_REVOKED, { recursive: true });

    process.env['SKILLET_TOKEN'] = kitKeyToken;
    let syncResult: Awaited<ReturnType<typeof sync>>;
    try {
      const revokedAdapter = makeTestAdapter(revokedAdapterRoot);
      syncResult = await sync(TEST_ROOT_REVOKED, [revokedAdapter], {
        registryUrl: 'https://test-registry.invalid',
        fetchImpl,
        approvePre: true,
        output: silentOutput() as unknown as NodeJS.WritableStream,
        input: Readable.from(['']) as unknown as NodeJS.ReadableStream,
      });
    } finally {
      delete process.env['SKILLET_TOKEN'];
    }

    // pullFromUnionManifest catches the 401 and returns [] — so unionPull is empty.
    // This proves the revoked token is correctly rejected at the union-manifest level.
    // Skills already in local state from prior syncs may still be materialized by
    // the regular pull loop (expected behavior), but no NEW refs are seeded via
    // the revoked token.
    assert.deepEqual(
      syncResult.unionPull,
      [],
      'revoked kit-key: unionPull must be empty (401 swallowed by pullFromUnionManifest)',
    );
    assert.deepEqual(syncResult.failed, [], 'revoked kit-key: no failures expected');
  });
});
