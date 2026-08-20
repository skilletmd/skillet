/**
 * Co-located web→registry SSR hits loopback with no X-Forwarded-For, so every
 * user's catalog/skill SSR shared one req.ip bucket and sitewide heavy_read 429s.
 * These tests pin: unkeyed loopback is exempt; BFF-forwarded client IPs still count.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  isLoopbackIp,
  isUnkeyedLoopbackClient,
  registerHttpSecurity,
  resetAmbientRateBuckets,
  resetHeavyReadBuckets,
  resetWriteRateBuckets,
} from '../src/http-security.js';

const HEAVY_URL = '/api/v1/skills/alice/cool-skill/download';
const LIGHT_URL = '/api/hc';

async function securityApp(trustProxy: boolean | number = false) {
  const app = Fastify({ logger: false, trustProxy });
  await registerHttpSecurity(app);
  app.get(LIGHT_URL, async () => ({ ok: true }));
  app.get(HEAVY_URL, async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('isLoopbackIp', () => {
  it('accepts IPv4 loopback, IPv6 loopback, and IPv4-mapped forms', () => {
    assert.equal(isLoopbackIp('127.0.0.1'), true);
    assert.equal(isLoopbackIp('127.0.0.42'), true);
    assert.equal(isLoopbackIp('::1'), true);
    assert.equal(isLoopbackIp('::ffff:127.0.0.1'), true);
    assert.equal(isLoopbackIp('10.0.0.1'), false);
    assert.equal(isLoopbackIp('203.0.113.9'), false);
    assert.equal(isLoopbackIp(undefined), false);
  });
});

describe('loopback HTTP rate-limit exemption', () => {
  const prevAmbient = process.env.SKILLET_AMBIENT_RATE_PER_MINUTE;
  let app: Awaited<ReturnType<typeof securityApp>>;

  before(async () => {
    process.env.SKILLET_AMBIENT_RATE_PER_MINUTE = '5';
    app = await securityApp(false);
  });

  after(async () => {
    await app.close();
    if (prevAmbient === undefined) delete process.env.SKILLET_AMBIENT_RATE_PER_MINUTE;
    else process.env.SKILLET_AMBIENT_RATE_PER_MINUTE = prevAmbient;
    resetAmbientRateBuckets();
    resetHeavyReadBuckets();
    resetWriteRateBuckets();
  });

  beforeEach(() => {
    resetAmbientRateBuckets();
    resetHeavyReadBuckets();
    resetWriteRateBuckets();
  });

  it('does not heavy_read-limit unkeyed loopback SSR (shared 127.0.0.1)', async () => {
    for (let i = 0; i < 80; i++) {
      const res = await app.inject({
        method: 'GET',
        url: HEAVY_URL,
        remoteAddress: '127.0.0.1',
      });
      assert.equal(res.statusCode, 200, `hit ${i}: ${res.body}`);
    }
  });

  it('still heavy_read-limits a public client IP after the budget', async () => {
    const IP = '203.0.113.10';
    let limited = false;
    for (let i = 0; i < 65; i++) {
      const res = await app.inject({ method: 'GET', url: HEAVY_URL, remoteAddress: IP });
      if (res.statusCode === 429) {
        const body = res.json() as { scope?: string };
        assert.equal(body.scope, 'heavy_read');
        limited = true;
        break;
      }
    }
    assert.equal(limited, true);
  });

  it('does not ambient-limit unkeyed loopback SSR past the tiny test budget', async () => {
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({
        method: 'GET',
        url: LIGHT_URL,
        remoteAddress: '127.0.0.1',
      });
      assert.equal(res.statusCode, 200, `hit ${i}: ${res.body}`);
    }
  });
});

describe('loopback + forwarded client IP still rate-limits', () => {
  let app: Awaited<ReturnType<typeof securityApp>>;

  before(async () => {
    app = await securityApp(1);
  });

  after(async () => {
    await app.close();
    resetHeavyReadBuckets();
  });

  beforeEach(() => {
    resetHeavyReadBuckets();
  });

  it('keys heavy_read on X-Forwarded-For when TRUST_PROXY honors the BFF hop', async () => {
    const CLIENT = '198.51.100.77';
    let limited = false;
    for (let i = 0; i < 65; i++) {
      const res = await app.inject({
        method: 'GET',
        url: HEAVY_URL,
        remoteAddress: '127.0.0.1',
        headers: { 'x-forwarded-for': CLIENT },
      });
      if (res.statusCode === 429) {
        const body = res.json() as { scope?: string };
        assert.equal(body.scope, 'heavy_read');
        limited = true;
        break;
      }
    }
    assert.equal(limited, true);

    // A different forwarded client must not share the exhausted bucket.
    const other = await app.inject({
      method: 'GET',
      url: HEAVY_URL,
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '198.51.100.78' },
    });
    assert.equal(other.statusCode, 200, other.body);
  });

  it('isUnkeyedLoopbackClient is false when req.ip is the forwarded client', () => {
    // Shape check for the helper used by the hooks (inject-free).
    assert.equal(isUnkeyedLoopbackClient('127.0.0.1', '198.51.100.77'), false);
    assert.equal(isUnkeyedLoopbackClient('127.0.0.1', '127.0.0.1'), true);
    assert.equal(isUnkeyedLoopbackClient('::1', '::1'), true);
  });
});
