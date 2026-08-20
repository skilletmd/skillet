import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyRegistryBearer,
  loadRegistryBearer,
} from '../src/auth-token.js';
import { skilletDir } from '../src/session-token.js';

describe('auth-token', () => {
  let prevSkilletDir: string | undefined;
  let prevToken: string | undefined;
  let tempHome: string;

  beforeEach(async () => {
    prevSkilletDir = process.env['SKILLET_DIR'];
    prevToken = process.env['SKILLET_TOKEN'];
    tempHome = await mkdtemp(join(tmpdir(), 'skillet-auth-token-'));
    process.env['SKILLET_DIR'] = join(tempHome, '.skillet');
    delete process.env['SKILLET_TOKEN'];
    delete process.env['SKILLET_TOKEN_FORCE'];
  });

  afterEach(() => {
    if (prevSkilletDir !== undefined) process.env['SKILLET_DIR'] = prevSkilletDir;
    else delete process.env['SKILLET_DIR'];
    if (prevToken !== undefined) process.env['SKILLET_TOKEN'] = prevToken;
    else delete process.env['SKILLET_TOKEN'];
    delete process.env['SKILLET_TOKEN_FORCE'];
  });

  it('classifies bearer token prefixes', () => {
    expect(classifyRegistryBearer('skillet_s_abc')).toBe('session');
    expect(classifyRegistryBearer('skillet_d_abc')).toBe('device');
    expect(classifyRegistryBearer('skillet_k_abc')).toBe('kit');
    expect(classifyRegistryBearer('')).toBe('none');
  });

  it('prefers linked device.json over session.json when paired via connect', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess' }) + '\n',
    );
    await writeFile(
      join(dir, 'device.json'),
      JSON.stringify({
        device_token: 'skillet_d_dev',
        device_id: 'dev-linked',
        label: 'Thiago Laptop',
      }) + '\n',
    );

    const bearer = await loadRegistryBearer();
    expect(bearer.kind).toBe('device');
    expect(bearer.token).toBe('skillet_d_dev');
  });

  it('a paired device.json wins over session.json', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess' }) + '\n',
    );
    await writeFile(
      join(dir, 'device.json'),
      JSON.stringify({
        device_token: 'skillet_d_dev',
        device_id: 'dev-paired',
        label: 'my-laptop',
      }) + '\n',
    );

    const bearer = await loadRegistryBearer();
    expect(bearer.kind).toBe('device');
    expect(bearer.token).toBe('skillet_d_dev');
  });

  it('a legacy anonymous device.json is ignored; session wins', async () => {
    // Every pre-change install wrote device.json with label 'anonymous'.
    // Migration 049 deletes its registry row, so the token is dangling — it
    // must not shadow a valid session or pass the pairing gate as a device.
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess' }) + '\n',
    );
    await writeFile(
      join(dir, 'device.json'),
      JSON.stringify({
        device_token: 'skillet_d_anon',
        device_id: 'dev-legacy',
        label: 'anonymous',
      }) + '\n',
    );

    const bearer = await loadRegistryBearer();
    expect(bearer.kind).toBe('session');
    expect(bearer.token).toBe('skillet_s_sess');
    // Cleanup-on-detect: the dead anon file is unlinked so the special case
    // can't leak into other read sites (link status, sync device id).
    await expect(access(join(dir, 'device.json'))).rejects.toThrow();
  });

  it('a legacy anonymous device.json with no session resolves to none', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'device.json'),
      JSON.stringify({
        device_token: 'skillet_d_anon',
        device_id: 'dev-legacy',
        label: 'anonymous',
      }) + '\n',
    );

    const bearer = await loadRegistryBearer();
    expect(bearer.kind).toBe('none');
  });

  it('returns device kind with only a stored device token', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'device.json'),
      JSON.stringify({ device_token: 'skillet_d_dev' }) + '\n',
    );

    const bearer = await loadRegistryBearer();
    expect(bearer.kind).toBe('device');
    expect(bearer.token).toBe('skillet_d_dev');
  });

  it('falls back to session.json when no device.json', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess' }) + '\n',
    );

    const bearer = await loadRegistryBearer();
    expect(bearer.kind).toBe('session');
    expect(bearer.token).toBe('skillet_s_sess');
  });

  it('uses SKILLET_TOKEN when SKILLET_TOKEN_FORCE=1 even if session.json exists', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess' }) + '\n',
    );
    process.env['SKILLET_TOKEN'] = 'skillet_k_force';
    process.env['SKILLET_TOKEN_FORCE'] = '1';

    const bearer = await loadRegistryBearer();
    expect(bearer.kind).toBe('kit');
    expect(bearer.token).toBe('skillet_k_force');
  });

  it('prefers session.json over SKILLET_TOKEN without SKILLET_TOKEN_FORCE', async () => {
    const dir = skilletDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'session.json'),
      JSON.stringify({ session_token: 'skillet_s_sess' }) + '\n',
    );
    process.env['SKILLET_TOKEN'] = 'skillet_k_env';

    const bearer = await loadRegistryBearer();
    expect(bearer.kind).toBe('session');
    expect(bearer.token).toBe('skillet_s_sess');
  });

  it('returns none with no stored credentials and never touches the network', async () => {
    const fetchSpy = vi.fn(async () => {
      throw new Error('unexpected network call');
    });
    vi.stubGlobal('fetch', fetchSpy as unknown as typeof fetch);
    try {
      const bearer = await loadRegistryBearer();
      expect(bearer.kind).toBe('none');
      expect(bearer.token).toBe('');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
