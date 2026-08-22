import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenApiDocument, OPENAPI_SCOPES } from '../src/openapi.js';

const doc = buildOpenApiDocument({
  siteUrl: 'https://skillet.md',
  registryUrl: 'https://registry.skillet.md',
});

/** Every (path, method) pair in the document, with its operation object. */
function operations(): Array<[string, string, Record<string, unknown>]> {
  const out: Array<[string, string, Record<string, unknown>]> = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      out.push([path, method, op as Record<string, unknown>]);
    }
  }
  return out;
}

describe('openapi document', () => {
  it('is a well-formed 3.1 document that survives a JSON round-trip', () => {
    assert.equal(doc.openapi, '3.1.0');
    const round = JSON.parse(JSON.stringify(doc));
    assert.deepEqual(round, doc);
  });

  it('lists the site mirror first and the registry origin second', () => {
    assert.deepEqual(
      doc.servers.map((s) => s.url),
      ['https://skillet.md/api/v1', 'https://registry.skillet.md/api/v1'],
    );
  });

  it('trims trailing slashes off the configured origins', () => {
    const trimmed = buildOpenApiDocument({
      siteUrl: 'https://skillet.md/',
      registryUrl: 'https://registry.skillet.md///',
    });
    assert.deepEqual(
      trimmed.servers.map((s) => s.url),
      ['https://skillet.md/api/v1', 'https://registry.skillet.md/api/v1'],
    );
  });

  // The three properties that decide whether an LLM can turn this document into
  // callable tools. A missing operationId collapses two tools into one; a
  // missing description makes the model guess when to call it.
  it('gives every operation a unique operationId, a summary, and a description', () => {
    const seen = new Set<string>();
    for (const [path, method, op] of operations()) {
      const id = op.operationId;
      assert.equal(typeof id, 'string', `${method.toUpperCase()} ${path} has no operationId`);
      assert.ok(!seen.has(id as string), `duplicate operationId: ${String(id)}`);
      seen.add(id as string);
      assert.equal(typeof op.summary, 'string', `${String(id)} has no summary`);
      assert.ok(
        typeof op.description === 'string' && (op.description as string).length > 20,
        `${String(id)} has no meaningful description`,
      );
    }
    assert.ok(seen.size >= 15, `expected a substantive surface, got ${seen.size} operations`);
  });

  it('types every parameter and describes what it is for', () => {
    for (const [path, method, op] of operations()) {
      for (const raw of (op.parameters as Array<Record<string, unknown>>) ?? []) {
        const where = `${method.toUpperCase()} ${path} → ${String(raw.name)}`;
        assert.ok(raw.schema, `${where} has no schema`);
        assert.equal(typeof raw.description, 'string', `${where} has no description`);
        assert.ok(['path', 'query', 'header'].includes(raw.in as string), `${where} bad "in"`);
        if (raw.in === 'path') assert.equal(raw.required, true, `${where} path param not required`);
      }
    }
  });

  it('declares a JSON response schema for every success and every error', () => {
    for (const [path, method, op] of operations()) {
      const responses = op.responses as Record<string, Record<string, unknown>>;
      assert.ok(responses['200'], `${method.toUpperCase()} ${path} declares no 200`);
      for (const code of ['400', '404', '429']) {
        assert.ok(responses[code], `${method.toUpperCase()} ${path} declares no ${code}`);
        const content = responses[code].content as Record<string, unknown>;
        assert.ok(content['application/json'], `${method} ${path} ${code} is not JSON`);
      }
    }
  });

  it('resolves every $ref against components/schemas', () => {
    const schemas = (doc.components.schemas ?? {}) as Record<string, unknown>;
    const missing: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') {
          const name = value.replace('#/components/schemas/', '');
          if (!(name in schemas)) missing.push(value);
        } else walk(value);
      }
    };
    walk(doc.paths);
    assert.deepEqual(missing, []);
  });

  it('documents the bearer scheme and the scopes a token can carry', () => {
    const schemes = doc.components.securitySchemes as Record<string, Record<string, unknown>>;
    assert.equal(schemes.bearerAuth.type, 'http');
    assert.equal(schemes.bearerAuth.scheme, 'bearer');
    // The scoped operations name a scope rather than an empty grant, which is
    // what "scoped permissions" means to a machine reading the document.
    const sync = doc.paths['/sync/manifest'].get as Record<string, unknown>;
    assert.deepEqual(sync.security, [{ bearerAuth: ['sync'] }]);
    for (const scope of Object.keys(OPENAPI_SCOPES)) {
      assert.ok(
        (schemes.bearerAuth.description as string).includes(scope),
        `scope ${scope} is not documented on the security scheme`,
      );
    }
  });

  it('marks the anonymous surface as callable without credentials', () => {
    assert.deepEqual(doc.security, [{}]);
  });
});
