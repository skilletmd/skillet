/**
 * Team commands resolve session from ~/.skillet/session.json (same as kit).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('team auth', () => {
  let skilletDir: string;
  const prevDir = process.env['SKILLET_DIR'];
  const prevToken = process.env['SKILLET_TOKEN'];

  beforeEach(async () => {
    vi.resetModules();
    skilletDir = await mkdtemp(join(tmpdir(), 'skillet-team-auth-'));
    process.env['SKILLET_DIR'] = skilletDir;
    delete process.env['SKILLET_TOKEN'];
  });

  afterEach(async () => {
    if (prevDir === undefined) delete process.env['SKILLET_DIR'];
    else process.env['SKILLET_DIR'] = prevDir;
    if (prevToken === undefined) delete process.env['SKILLET_TOKEN'];
    else process.env['SKILLET_TOKEN'] = prevToken;
    await rm(skilletDir, { recursive: true, force: true });
  });

  it('createOrg uses session.json when SKILLET_TOKEN env is unset', async () => {
    await mkdir(skilletDir, { recursive: true });
    await writeFile(
      join(skilletDir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_from_file' }),
      'utf8',
    );

    const fetchImpl = vi.fn(async (): Promise<Response> => {
      return new Response(
        JSON.stringify({ org_id: 'org-1', slug: 'cli-team', name: 'CliTeam' }),
        { status: 201, headers: { 'content-type': 'application/json' } },
      );
    });

    const { createOrg } = await import('../src/commands/team.js');
    const result = await createOrg({
      slug: 'cli-team',
      name: 'CliTeam',
      registryUrl: 'https://registry.example',
      fetchImpl: fetchImpl as typeof fetch,
    });

    expect(result.slug).toBe('cli-team');
    expect(fetchImpl).toHaveBeenCalledOnce();
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).authorization).toBe(
      'Bearer skillet_s_from_file',
    );
  });
});
