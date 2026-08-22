/**
 * The RateLimit header fields, on every metered response.
 *
 * An audit of the public API found none: the budgets existed and were enforced,
 * but the only thing a client ever learned was a `429` after the fact. An agent
 * with no way to see its remaining budget either hammers the origin or throttles
 * itself to a crawl, and both are worse than telling it the number.
 *
 * Both spellings ship on purpose — see setRateLimitHeaders in http-security.ts.
 */
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  registerHttpSecurity,
  resetAmbientRateBuckets,
  resetHeavyReadBuckets,
  resetWriteRateBuckets,
} from '../src/http-security.js';

const LIGHT_URL = '/api/hc';
const HEAVY_URL = '/api/v1/skills/alice/cool-skill/download';
const WRITE_URL = '/api/v1/skills';
const CLIENT = '198.51.100.7';

async function securityApp() {
  const app = Fastify({ logger: false });
  await registerHttpSecurity(app);
  app.get(LIGHT_URL, async () => ({ ok: true }));
  app.get(HEAVY_URL, async () => ({ ok: true }));
  app.post(WRITE_URL, async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('RateLimit response headers', () => {
  const prevAmbient = process.env.SKILLET_AMBIENT_RATE_PER_MINUTE;
  let app: Awaited<ReturnType<typeof securityApp>>;

  before(async () => {
    process.env.SKILLET_AMBIENT_RATE_PER_MINUTE = '5';
    app = await securityApp();
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

  it('reports limit, remaining, and reset on a successful ambient read', async () => {
    const res = await app.inject({ method: 'GET', url: LIGHT_URL, remoteAddress: CLIENT });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['ratelimit-limit'], '5');
    assert.equal(res.headers['ratelimit-remaining'], '4');
    const reset = Number(res.headers['ratelimit-reset']);
    assert.ok(reset >= 1 && reset <= 60, `reset out of range: ${reset}`);
  });

  it('decrements remaining across the window', async () => {
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: LIGHT_URL, remoteAddress: CLIENT });
      seen.push(Number(res.headers['ratelimit-remaining']));
    }
    assert.deepEqual(seen, [4, 3, 2]);
  });

  it('emits the structured-field spelling alongside the legacy triple', async () => {
    const res = await app.inject({ method: 'GET', url: LIGHT_URL, remoteAddress: CLIENT });
    assert.equal(res.headers['ratelimit-policy'], '"ambient"; q=5; w=60');
    assert.match(String(res.headers['ratelimit']), /^"ambient"; r=4; t=\d+$/);
  });

  it('names the cost class the request was charged to', async () => {
    const heavy = await app.inject({ method: 'GET', url: HEAVY_URL, remoteAddress: CLIENT });
    assert.match(String(heavy.headers['ratelimit-policy']), /^"heavy_read";/);

    const write = await app.inject({ method: 'POST', url: WRITE_URL, remoteAddress: CLIENT });
    assert.match(String(write.headers['ratelimit-policy']), /^"write";/);
  });

  it('reports zero remaining and a Retry-After on the 429', async () => {
    let limited: Awaited<ReturnType<typeof app.inject>> | null = null;
    for (let i = 0; i < 8; i++) {
      const res = await app.inject({ method: 'GET', url: LIGHT_URL, remoteAddress: CLIENT });
      if (res.statusCode === 429) {
        limited = res;
        break;
      }
    }
    assert.ok(limited, 'never hit the budget');
    assert.equal(limited.headers['ratelimit-remaining'], '0');
    assert.equal(limited.headers['ratelimit-limit'], '5');
    // Retry-After and RateLimit-Reset describe the same window, so they agree.
    assert.equal(limited.headers['retry-after'], limited.headers['ratelimit-reset']);
    assert.equal((limited.json() as { scope?: string }).scope, 'ambient');
  });

  // Unkeyed loopback SSR is exempt from the bucket by design; an exempt request
  // must not carry a budget it was never charged against.
  it('reports nothing for a request that was never metered', async () => {
    const res = await app.inject({ method: 'GET', url: LIGHT_URL, remoteAddress: '127.0.0.1' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['ratelimit-limit'], undefined);
    assert.equal(res.headers['ratelimit'], undefined);
  });
});
