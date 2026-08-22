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
  isSharedCacheable,
  registerHttpSecurity,
  resetAmbientRateBuckets,
  resetHeavyReadBuckets,
  resetWriteRateBuckets,
} from '../src/http-security.js';

const LIGHT_URL = '/api/hc';
const HEAVY_URL = '/api/v1/skills/alice/cool-skill/download';
const WRITE_URL = '/api/v1/skills';
const CLIENT = '198.51.100.7';

/** Mirrors the catalog routes: shared-cacheable, exactly as they answer today. */
const CACHED_URL = '/api/v1/skills';

async function securityApp() {
  const app = Fastify({ logger: false });
  await registerHttpSecurity(app);
  app.get(LIGHT_URL, async () => ({ ok: true }));
  app.get(HEAVY_URL, async () => ({ ok: true }));
  app.post(WRITE_URL, async () => ({ ok: true }));
  app.get(CACHED_URL, async (_req, reply) => {
    reply.header('cache-control', 'public, max-age=60, s-maxage=60');
    return { ok: true };
  });
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

describe('isSharedCacheable', () => {
  it('recognizes the policies a CDN will store', () => {
    assert.equal(isSharedCacheable('public, max-age=60, s-maxage=60'), true);
    assert.equal(isSharedCacheable('public'), true);
    assert.equal(isSharedCacheable('s-maxage=30'), true);
  });

  it('recognizes the policies that keep a body out of a shared cache', () => {
    assert.equal(isSharedCacheable('no-store'), false);
    assert.equal(isSharedCacheable('private, max-age=60'), false);
    assert.equal(isSharedCacheable('public, s-maxage=0'), false);
    assert.equal(isSharedCacheable('max-age=60'), false);
    assert.equal(isSharedCacheable(undefined), false);
  });
});

/**
 * The bug this section exists to prevent coming back.
 *
 * Catalog and search answer `public, s-maxage=60` and Cloudflare really does
 * cache them, so a per-caller counter on one of those bodies would be handed to
 * every later caller for the next minute. A wrong RateLimit-Remaining is worse
 * than none: the header exists to be acted on.
 */
describe('per-caller counters never ride a shared-cacheable response', () => {
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
  });

  beforeEach(() => {
    resetAmbientRateBuckets();
  });

  it('omits remaining, reset, and the combined field on a cached response', async () => {
    const res = await app.inject({ method: 'GET', url: CACHED_URL, remoteAddress: CLIENT });
    assert.equal(res.headers['ratelimit-remaining'], undefined);
    assert.equal(res.headers['ratelimit-reset'], undefined);
    assert.equal(res.headers['ratelimit'], undefined);
  });

  // The policy is the same for everyone, so it is correct in a shared cache and
  // still lets an agent pace itself.
  it('still states the policy, which is identical for every caller', async () => {
    const res = await app.inject({ method: 'GET', url: CACHED_URL, remoteAddress: CLIENT });
    assert.equal(res.headers['ratelimit-limit'], '5');
    assert.equal(res.headers['ratelimit-policy'], '"ambient"; q=5; w=60');
  });

  it('sends the live counter on an uncached response', async () => {
    const res = await app.inject({ method: 'GET', url: LIGHT_URL, remoteAddress: CLIENT });
    assert.equal(res.headers['ratelimit-remaining'], '4');
    assert.ok(res.headers['ratelimit']);
  });

  // Two callers hitting the cached route must not see each other's numbers.
  it('leaks nothing between callers on the cached route', async () => {
    for (let i = 0; i < 3; i++) {
      await app.inject({ method: 'GET', url: CACHED_URL, remoteAddress: '203.0.113.1' });
    }
    const other = await app.inject({
      method: 'GET',
      url: CACHED_URL,
      remoteAddress: '203.0.113.2',
    });
    assert.equal(other.headers['ratelimit-remaining'], undefined);
  });

  it('marks the 429 no-store so it is never cached, and sends the full set', async () => {
    let limited: Awaited<ReturnType<typeof app.inject>> | null = null;
    for (let i = 0; i < 8; i++) {
      const res = await app.inject({ method: 'GET', url: CACHED_URL, remoteAddress: CLIENT });
      if (res.statusCode === 429) {
        limited = res;
        break;
      }
    }
    assert.ok(limited, 'never hit the budget');
    assert.equal(limited.headers['cache-control'], 'no-store');
    assert.equal(limited.headers['ratelimit-remaining'], '0');
    assert.equal(limited.headers['retry-after'], limited.headers['ratelimit-reset']);
  });
});

