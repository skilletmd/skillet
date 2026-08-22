// The machine-facing contract: one OpenAPI description, one JSON error shape.
//
// Hermetic — it wires the same two registrations `createServer` uses onto a
// bare Fastify instance, so it runs without MySQL while still exercising the
// real hook and the real route.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildOpenApiDocument, OPENAPI_SCOPES } from '@skillet/protocol/openapi';
import { registerOpenApiRoutes } from '../src/routes/openapi.js';
import {
  deriveErrorCode,
  isEnvelopableError,
  registerErrorEnvelope,
  withErrorEnvelope,
} from '../src/error-envelope.js';
import { scopesFor } from '../src/auth/tokens.js';

async function harness(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerErrorEnvelope(app);
  registerOpenApiRoutes(app);
  // Stand-ins for the two error shapes real handlers actually send.
  app.get('/prose-404', async (_req, reply) => reply.code(404).send({ error: 'Skill not found' }));
  app.get('/coded-422', async (_req, reply) =>
    reply.code(422).send({ error: 'invalid_slug', message: 'Slug must be lowercase.' }),
  );
  app.get('/ok', async () => ({ ok: true }));
  app.get('/bytes-404', async (_req, reply) =>
    reply.code(404).type('application/zip').send(Buffer.from('not-json')),
  );
  await app.ready();
  return app;
}

describe('openapi route', () => {
  it('serves the document at the root and under the version prefix', async () => {
    const app = await harness();
    for (const url of ['/openapi.json', '/api/v1/openapi.json']) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 200, url);
      assert.match(res.headers['content-type'] as string, /application\/json/);
      const doc = res.json();
      assert.equal(doc.openapi, '3.1.0');
      assert.ok(doc.paths['/skills'], 'catalog operation missing');
      assert.ok(doc.components.securitySchemes.bearerAuth, 'security scheme missing');
    }
    await app.close();
  });

  it('names this deployment’s own origin as a server', async () => {
    const app = await harness();
    const res = await app.inject({
      method: 'GET',
      url: '/openapi.json',
      headers: { host: 'registry.example.test' },
    });
    const urls: string[] = res.json().servers.map((s: { url: string }) => s.url);
    assert.ok(
      urls.some((u) => u.startsWith('http://registry.example.test')),
      `expected the request host in ${JSON.stringify(urls)}`,
    );
    await app.close();
  });

  // A scope documented in the spec that the token layer does not actually grant
  // is worse than no documentation: it tells an integrator to expect access the
  // registry will refuse.
  it('documents exactly the scopes the token classes grant', () => {
    const granted = new Set<string>();
    for (const cls of ['device', 'session', 'kit', 'mcp'] as const) {
      for (const scope of scopesFor(cls)) granted.add(scope);
    }
    assert.deepEqual(
      Object.keys(OPENAPI_SCOPES).sort(),
      [...granted].sort(),
      'OPENAPI_SCOPES has drifted from SCOPES in auth/tokens.ts',
    );
  });

  it('builds without a configured public origin', () => {
    const doc = buildOpenApiDocument({ siteUrl: 'https://x.test', registryUrl: 'https://y.test' });
    assert.equal(doc.servers.length, 2);
  });
});

describe('error envelope', () => {
  it('adds a code and a docs pointer to a prose error without losing it', async () => {
    const app = await harness();
    const res = await app.inject({ method: 'GET', url: '/prose-404' });
    assert.equal(res.statusCode, 404);
    const body = res.json();
    assert.equal(body.error, 'Skill not found', 'the original field survives');
    assert.equal(body.code, 'skill_not_found');
    assert.equal(body.statusCode, 404);
    assert.match(body.docs, /^https?:\/\/.+\/docs\/api#errors$/);
    await app.close();
  });

  it('keeps a handler’s own snake_case code rather than re-deriving one', async () => {
    const app = await harness();
    const body = (await app.inject({ method: 'GET', url: '/coded-422' })).json();
    assert.equal(body.code, 'invalid_slug');
    assert.equal(body.message, 'Slug must be lowercase.');
    await app.close();
  });

  it('answers an unrouted path with the same shape, pointing at the spec', async () => {
    const app = await harness();
    const res = await app.inject({ method: 'GET', url: '/no/such/route' });
    assert.equal(res.statusCode, 404);
    const body = res.json();
    assert.equal(body.code, 'route_not_found');
    assert.match(body.message, /openapi\.json/);
    assert.match(body.docs, /docs\/api#errors/);
    await app.close();
  });

  it('leaves success bodies and non-JSON error bytes untouched', async () => {
    const app = await harness();
    assert.deepEqual((await app.inject({ method: 'GET', url: '/ok' })).json(), { ok: true });
    const bytes = await app.inject({ method: 'GET', url: '/bytes-404' });
    assert.equal(bytes.statusCode, 404);
    assert.equal(bytes.body, 'not-json');
    await app.close();
  });

  it('derives stable codes and refuses to touch what it should not', () => {
    assert.equal(deriveErrorCode({ error: 'Author not found' }, 404), 'author_not_found');
    assert.equal(deriveErrorCode({ code: 'handle_not_claimed' }, 403), 'handle_not_claimed');
    assert.equal(deriveErrorCode({}, 429), 'rate_limited');
    assert.equal(deriveErrorCode({ error: '   ' }, 401), 'unauthorized');
    // A prose string that slugifies to nothing usable falls back to the status.
    assert.equal(deriveErrorCode({ error: '!!!' }, 400), 'bad_request');

    assert.equal(isEnvelopableError(200, 'application/json', {}), false);
    assert.equal(isEnvelopableError(404, 'text/html', {}), false);
    assert.equal(isEnvelopableError(404, 'application/json', [1, 2]), false);
    assert.equal(isEnvelopableError(404, 'application/json', null), false);
    assert.equal(isEnvelopableError(404, 'application/json', {}), true);

    // Idempotent: a body that already carries the envelope is returned as-is.
    const once = withErrorEnvelope({ error: 'nope' }, 404);
    assert.equal(withErrorEnvelope(once, 404), once);
  });
});
