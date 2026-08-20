/**
 * The desktop webview's fixed origins are baked into the CORS allowlist so the
 * device-sync SSE stream passes preflight in every environment (the tray fetch
 * died on preflight forever, silently, because only env-configured web origins
 * were allowed). These tests pin the allowlist's shape and its boundaries:
 * exact-string echo for desktop origins, no reflection for anything else —
 * including the confusion origins a sloppy future RegExp would admit — and the
 * env-configured origins staying additive.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  DESKTOP_WEBVIEW_ORIGINS,
  registerHttpSecurity,
  resolveCorsOrigins,
} from '../src/http-security.js';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await registerHttpSecurity(app);
  await app.ready();
  return app;
}

function preflight(app: FastifyInstance, origin: string) {
  return app.inject({
    method: 'OPTIONS',
    url: '/api/v1/devices/sync/stream',
    headers: {
      origin,
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'authorization',
    },
  });
}

describe('desktop webview CORS allowlist', () => {
  let app: FastifyInstance;
  before(async () => {
    app = await buildApp();
  });
  after(async () => {
    await app.close();
  });

  it('allowlist shape tripwire: exactly the three fixed string literals', () => {
    // Trips a future RegExp/function/wildcard conversion directly — the
    // behavioral tests below could miss a sloppy regex by luck.
    assert.deepEqual(DESKTOP_WEBVIEW_ORIGINS, [
      'tauri://localhost',
      'http://tauri.localhost',
      'https://tauri.localhost',
    ]);
    for (const o of DESKTOP_WEBVIEW_ORIGINS) {
      assert.equal(typeof o, 'string');
      assert.notEqual(o, '*');
      assert.notEqual(o, 'null');
    }
  });

  it('echoes each desktop origin exactly on preflight', async () => {
    for (const origin of DESKTOP_WEBVIEW_ORIGINS) {
      const res = await preflight(app, origin);
      assert.equal(res.statusCode, 204, origin);
      assert.equal(res.headers['access-control-allow-origin'], origin);
      assert.equal(res.headers['access-control-allow-credentials'], 'true');
      assert.match(String(res.headers['access-control-allow-headers']), /authorization/i);
    }
  });

  it('adds vary: origin so shared caches never cross-serve preflights', async () => {
    const res = await preflight(app, 'tauri://localhost');
    assert.match(String(res.headers['vary']), /origin/i);
  });

  it('reflects nothing for an arbitrary web origin', async () => {
    const res = await preflight(app, 'https://evil.example');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('never allows the literal null origin (sandboxed-iframe CSRF vector)', async () => {
    const res = await preflight(app, 'null');
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  it('rejects confusion origins a sloppy regex would admit', async () => {
    for (const origin of [
      'https://tauri.localhost.evil.example', // suffix-anchor regression
      'http://tauri.localhost:8080', // port-variant regression
    ]) {
      const res = await preflight(app, origin);
      assert.equal(res.headers['access-control-allow-origin'], undefined, origin);
    }
  });

  it('carries no set-cookie anywhere near the stream surface', async () => {
    // The credentials:true stance is safe only while the registry stays
    // cookie-free; a cookie would upgrade the spoofable http://tauri.localhost
    // origin from anonymous-tier to credentialed reads. Tripwire it.
    const res = await preflight(app, 'tauri://localhost');
    assert.equal(res.headers['set-cookie'], undefined);
  });

  it('keeps env-configured origins additive to the baked-in set', async () => {
    const prev = process.env['SKILLET_CORS_ORIGINS'];
    process.env['SKILLET_CORS_ORIGINS'] = 'https://skillet.md';
    let envApp: FastifyInstance | null = null;
    try {
      envApp = await buildApp();
      const web = await preflight(envApp, 'https://skillet.md');
      assert.equal(web.headers['access-control-allow-origin'], 'https://skillet.md');
      const desktop = await preflight(envApp, 'tauri://localhost');
      assert.equal(desktop.headers['access-control-allow-origin'], 'tauri://localhost');
    } finally {
      if (prev === undefined) delete process.env['SKILLET_CORS_ORIGINS'];
      else process.env['SKILLET_CORS_ORIGINS'] = prev;
      await envApp?.close();
    }
  });

  it('resolveCorsOrigins stays env-only for the trust-proxy warning signal', () => {
    // scrub-env.mjs cleared SKILLET_CORS_ORIGINS/SKILLET_WEB_URL at load, so
    // with no env the resolver must stay empty — main.ts reads its emptiness
    // as "no operator-configured web origin".
    assert.deepEqual(resolveCorsOrigins(), []);
  });
});
