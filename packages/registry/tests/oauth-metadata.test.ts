/**
 * RFC 9728 protected-resource metadata, and the RFC 6750 challenge that points
 * at it.
 *
 * The gap this closes: the registry has always accepted bearer tokens and
 * enforced a fixed scope set per token class, but published that only as prose.
 * An agent could not request least privilege because it could not discover what
 * "less" was, and a 401 named no way to find out. Hermetic — no MySQL, just the
 * route registration and the document builder.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  bearerChallenge,
  buildProtectedResourceMetadata,
  OPENAPI_SCOPES,
  PROTECTED_RESOURCE_WELL_KNOWN,
} from '@skillet/protocol/protected-resource';
import { registerOAuthMetadataRoutes } from '../src/routes/oauth-metadata.js';
import { scopesFor } from '../src/auth/tokens.js';

const ORIGINS = { siteUrl: 'https://skillet.md', registryUrl: 'https://registry.skillet.md' };

async function harness(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerOAuthMetadataRoutes(app);
  await app.ready();
  return app;
}

describe('/.well-known/oauth-protected-resource', () => {
  it('serves both documents as JSON, readable cross-origin', async () => {
    const app = await harness();
    for (const url of Object.values(PROTECTED_RESOURCE_WELL_KNOWN)) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 200, url);
      assert.match(res.headers['content-type'] as string, /application\/json/);
      assert.equal(res.headers['access-control-allow-origin'], '*');
    }
    await app.close();
  });

  it('names the resource the token is actually presented to', async () => {
    const app = await harness();
    process.env.SKILLET_REGISTRY_PUBLIC_URL = 'https://registry.skillet.md';
    const api = (await app.inject({ url: PROTECTED_RESOURCE_WELL_KNOWN.api })).json();
    const mcp = (await app.inject({ url: PROTECTED_RESOURCE_WELL_KNOWN.mcp })).json();
    assert.equal(api.resource, 'https://registry.skillet.md/api/v1');
    assert.equal(mcp.resource, 'https://registry.skillet.md/api/v1/mcp');
    delete process.env.SKILLET_REGISTRY_PUBLIC_URL;
    await app.close();
  });

  // The whole point: scopes as data, not prose.
  it('publishes scopes_supported, and it matches what tokens actually grant', () => {
    const doc = buildProtectedResourceMetadata('api', ORIGINS);
    const granted = new Set<string>();
    for (const cls of ['device', 'session', 'kit', 'mcp'] as const) {
      for (const scope of scopesFor(cls)) granted.add(scope);
    }
    assert.deepEqual(
      (doc.scopes_supported as string[]).slice().sort(),
      [...granted].sort(),
      'scopes_supported has drifted from SCOPES in auth/tokens.ts',
    );
    assert.deepEqual(doc.scopes_supported, Object.keys(OPENAPI_SCOPES));
  });

  // An MCP link is read-only by construction (R7). The document must not imply
  // a client could ask for more.
  it('scopes the MCP resource to `read` alone', () => {
    const doc = buildProtectedResourceMetadata('mcp', ORIGINS);
    assert.deepEqual(doc.scopes_supported, ['read']);
  });

  // The token is also accepted as a URL path segment, which is not one of the
  // three RFC 6750 methods, so it must not be claimed here.
  it('claims only the RFC 6750 header method', () => {
    for (const resource of ['api', 'mcp'] as const) {
      const doc = buildProtectedResourceMetadata(resource, ORIGINS);
      assert.deepEqual(doc.bearer_methods_supported, ['header']);
    }
  });

  // Listing an issuer that cannot serve RFC 8414 metadata sends a conforming
  // client into a discovery loop that dead-ends. Skillet runs no authorization
  // server, so the OPTIONAL member stays absent until there is one to name.
  it('advertises no authorization server, because there is none', () => {
    const doc = buildProtectedResourceMetadata('api', ORIGINS);
    assert.equal('authorization_servers' in doc, false);
  });
});

describe('WWW-Authenticate challenge', () => {
  it('is a well-formed Bearer challenge naming the metadata URL', () => {
    const header = bearerChallenge('mcp', ORIGINS);
    assert.match(header, /^Bearer realm="skillet", /);
    assert.match(header, /error="invalid_token"/);
    assert.match(header, /scope="read"/);
    assert.match(
      header,
      /resource_metadata="https:\/\/registry\.skillet\.md\/\.well-known\/oauth-protected-resource\/api\/v1\/mcp"/,
    );
  });

  it('distinguishes a missing credential from a rejected one', () => {
    assert.match(bearerChallenge('mcp', ORIGINS, 'invalid_request'), /error="invalid_request"/);
    assert.match(bearerChallenge('mcp', ORIGINS, 'invalid_token'), /error="invalid_token"/);
  });

  // The URL in the challenge has to be a URL the origin serves, or the whole
  // discovery chain dead-ends at a 404.
  it('points at a path the registry actually routes', async () => {
    const app = await harness();
    const header = bearerChallenge('mcp', ORIGINS);
    const url = /resource_metadata="([^"]+)"/.exec(header)![1]!;
    const res = await app.inject({ method: 'GET', url: new URL(url).pathname });
    assert.equal(res.statusCode, 200);
    await app.close();
  });
});
