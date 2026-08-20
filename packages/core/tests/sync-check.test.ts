/**
 * `sync({ checkOnly: true })` — detect changes without materializing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sync } from '../src/commands/sync.js';
import type { Adapter } from '../src/adapter.js';
import { atomicWrite } from '../src/util/atomic.js';

const TEST_ROOT = vi.hoisted(() => {
  const { redirectHome } = require('./helpers/redirect-home.cjs');
  return redirectHome('skillet-sync-check');
});

const CLAUDE_DIR = join(TEST_ROOT, '.claude', 'skills');

describe('sync() checkOnly', () => {
  const cwd = TEST_ROOT;
  const etagPath = join(TEST_ROOT, 'etag-cache.json');
  const registryUrl = 'https://registry.test';

  beforeEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
    await mkdir(CLAUDE_DIR, { recursive: true });
    const skilletDir = process.env['SKILLET_DIR'] as string;
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'device.json'),
      `${JSON.stringify({ device_id: 'dev-1', device_token: 'skillet_d_test' })}\n`,
    );
    await atomicWrite(
      etagPath,
      JSON.stringify({
        version: 1,
        entries: {},
        union: { [`${registryUrl}|dev-1|device`]: '"cached-union"' },
      }),
      { backup: false },
    );
  });

  afterEach(async () => {
    await rm(TEST_ROOT, { recursive: true, force: true });
  });

  it('returns changed:false and skips adapter.materialize when manifest is 304', async () => {
    const materialize = vi.fn(async () => [] as string[]);
    const adapter: Adapter = {
      name: 'claude-code',
      targetDir: CLAUDE_DIR,
      async detect() {
        return true;
      },
      targetPath(slug: string) {
        return join(CLAUDE_DIR, slug, 'SKILL.md');
      },
      targetSkillDir(slug: string) {
        return join(CLAUDE_DIR, slug);
      },
      materialize,
    };

    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/sync/manifest')) {
        expect(init?.headers).toMatchObject({ 'if-none-match': '"cached-union"' });
        return new Response(null, {
          status: 304,
          headers: { etag: '"cached-union"' },
        });
      }
      return new Response(JSON.stringify({ error: 'offline' }), { status: 503 });
    }) as unknown as typeof fetch;

    const result = await sync(cwd, [adapter], {
      token: 'skillet_d_test',
      registryUrl,
      fetchImpl,
      checkOnly: true,
      etagCachePath: etagPath,
      pullMode: 'interactive',
    });

    expect(result.changed).toBe(false);
    expect(materialize).not.toHaveBeenCalled();
    expect(result.adapters).toEqual([]);
  });

  it('returns changed:true when union manifest adds a new ref', async () => {
    const materialize = vi.fn(async () => [] as string[]);
    const adapter: Adapter = {
      name: 'claude-code',
      targetDir: CLAUDE_DIR,
      async detect() {
        return true;
      },
      targetPath(slug: string) {
        return join(CLAUDE_DIR, slug, 'SKILL.md');
      },
      targetSkillDir(slug: string) {
        return join(CLAUDE_DIR, slug);
      },
      materialize,
    };

    const skillMd = '---\nname: new-skill\n---\n\nbody\n';
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes('/sync/manifest')) {
        return new Response(
          JSON.stringify({
            schema_version: 1,
            etag: 'sha256:' + 'b'.repeat(64),
            sync_interval_seconds: 86400,
            account_scope: 'user',
            items: [
              {
                ref: '@alice/new-skill',
                version: 1,
                content_hash: 'sha256:' + 'c'.repeat(64),
                signature: null,
                author_key_id: null,
                policy: 'manual',
                source_kit: '@alice/kit',
                external_author: true,
              },
            ],
          }),
          { status: 200, headers: { etag: '"new"', 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/skills/alice/new-skill/manifest')) {
        return new Response(
          JSON.stringify({
            latest_hash: 'c'.repeat(64),
            versions: [{ hash: 'c'.repeat(64), version: 1, yanked: false }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/skills/alice/new-skill/versions/')) {
        return new Response(
          JSON.stringify({
            bundle: { files: { 'SKILL.md': Buffer.from(skillMd).toString('base64') } },
            signature: null,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ error: 'offline' }), { status: 503 });
    }) as unknown as typeof fetch;

    const result = await sync(cwd, [adapter], {
      token: 'skillet_d_test',
      registryUrl,
      fetchImpl,
      checkOnly: true,
      etagCachePath: etagPath,
      pullMode: 'interactive',
    });

    expect(result.changed).toBe(true);
    expect(materialize).not.toHaveBeenCalled();
  });
});
