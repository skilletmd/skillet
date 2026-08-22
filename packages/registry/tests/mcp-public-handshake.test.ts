/**
 * The hosted MCP endpoint's anonymous surface.
 *
 * The audit that prompted this: "MCP manifest found at /.well-known/mcp.json
 * but protocol handshake failed." It failed because `initialize` answered 401,
 * which to every MCP client (and every prober) reads as a broken server rather
 * than a locked one. The four protocol methods describe the server, not any
 * user's kit, so they answer without a token; everything that reads a kit still
 * challenges.
 *
 * Hermetic: an anonymous request never reaches Prisma (resolveServeAuthPrisma
 * short-circuits on a token that is missing or not `skillet_m_`-classed), so
 * the stub below is only there to satisfy the constructor.
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { DatabaseSync } from '../src/db/sqlite-handle.js';
import type { BlobStore } from '../src/blob-store/types.js';
import { registerMcpRoutes } from '../src/routes/mcp.js';

/** Answers "no such link" without a database, and records if it was consulted. */
let prismaCalls = 0;
const prismaStub = {
  mcp_links: {
    findFirst: async () => {
      prismaCalls += 1;
      return null;
    },
  },
} as unknown as PrismaClient;

const rpc = (method: string, params?: unknown) => ({
  jsonrpc: '2.0' as const,
  id: 1,
  method,
  ...(params === undefined ? {} : { params }),
});

let app: FastifyInstance;

before(async () => {
  app = Fastify({ logger: false });
  registerMcpRoutes(app, {} as DatabaseSync, {} as BlobStore, prismaStub);
  await app.ready();
});

after(async () => {
  await app.close();
});

async function post(body: unknown, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/mcp',
    headers: { 'content-type': 'application/json', ...headers },
    payload: body,
  });
}

describe('anonymous protocol handshake', () => {
  it('answers initialize with capabilities and serverInfo', async () => {
    const res = await post(
      rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'probe', version: '1' },
      }),
    );
    assert.equal(res.statusCode, 200);
    const body = res.json() as { result?: Record<string, unknown> };
    assert.ok(body.result, `no result: ${res.body}`);
    assert.ok(body.result.protocolVersion, 'no negotiated protocol version');
    assert.ok(body.result.capabilities, 'no capabilities');
    assert.equal((body.result.serverInfo as { name: string }).name.length > 0, true);
  });

  it('answers ping', async () => {
    const res = await post(rpc('ping'));
    assert.equal(res.statusCode, 200);
    assert.deepEqual((res.json() as { result: unknown }).result, {});
  });

  it('lists the tool surface, which is the same for every caller', async () => {
    const res = await post(rpc('tools/list'));
    assert.equal(res.statusCode, 200);
    const tools = (res.json() as { result: { tools: Array<{ name: string }> } }).result.tools;
    const names = tools.map((t) => t.name);
    // The hosted surface carries the deep-research aliases on top of the core
    // tools, same as an authenticated caller sees.
    for (const expected of ['list_skills', 'get_skill', 'search', 'fetch']) {
      assert.ok(names.includes(expected), `missing tool ${expected}: ${names.join(', ')}`);
    }
  });

  it('accepts the initialized notification with a 202 and no body', async () => {
    const res = await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(res.statusCode, 202);
  });

  it('never consults the database for an anonymous handshake', async () => {
    prismaCalls = 0;
    await post(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} }));
    await post(rpc('tools/list'));
    assert.equal(prismaCalls, 0);
  });
});

describe('anything that reads a kit still requires a token', () => {
  for (const method of ['tools/call', 'resources/list', 'resources/read']) {
    it(`challenges ${method}`, async () => {
      const res = await post(rpc(method, { name: 'list_skills', arguments: {} }));
      assert.equal(res.statusCode, 401, `${method}: ${res.body}`);
      assert.equal((res.json() as { error: string }).error, 'auth_required');
    });
  }

  it('challenges an unknown method rather than answering it', async () => {
    const res = await post(rpc('kits/steal'));
    assert.equal(res.statusCode, 401);
  });

  it('challenges a malformed envelope rather than treating it as public', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/mcp',
      headers: { 'content-type': 'application/json' },
      payload: '{"not":"jsonrpc"}',
    });
    assert.equal(res.statusCode, 401);
  });
});

describe('WWW-Authenticate on every anonymous response', () => {
  // RFC 6750 §3 + RFC 9728 §5.1. `resource_metadata` is the discovery path
  // MCP's authorization spec has clients follow.
  it('names the protected-resource metadata URL on a 401', async () => {
    const res = await post(rpc('tools/call', { name: 'list_skills', arguments: {} }));
    const challenge = String(res.headers['www-authenticate']);
    assert.match(challenge, /^Bearer realm="skillet"/);
    assert.match(challenge, /resource_metadata="[^"]*\/\.well-known\/oauth-protected-resource\/api\/v1\/mcp"/);
  });

  it('distinguishes a missing credential from a rejected one', async () => {
    const missing = await post(rpc('tools/call', { name: 'list_skills' }));
    assert.match(String(missing.headers['www-authenticate']), /error="invalid_request"/);

    // A well-formed `skillet_m_` token that resolves to no link is a rejection.
    prismaCalls = 0;
    const rejected = await post(rpc('tools/call', { name: 'list_skills' }), {
      authorization: `Bearer skillet_m_${'0'.repeat(64)}`,
    });
    assert.equal(prismaCalls, 1, 'a well-formed token should have been looked up');
    assert.match(String(rejected.headers['www-authenticate']), /error="invalid_token"/);
  });

  it('carries the challenge on the successful handshake too', async () => {
    const res = await post(rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} }));
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['www-authenticate']), /resource_metadata=/);
  });
});
