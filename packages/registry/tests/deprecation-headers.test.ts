/**
 * The headers that back the promise in /docs/versioning: "nothing in the
 * documented surface is removed without appearing in a response header first."
 *
 * The formats are easy to get subtly wrong and impossible to notice by eye —
 * `Sunset` takes an HTTP-date and `Deprecation` takes a structured-field Item,
 * so an epoch in the wrong one parses as garbage at the client rather than
 * failing here.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  deprecationHeaders,
  deprecationPolicyUrl,
  markDeprecated,
} from '../src/lib/deprecation.js';

const DOCS = 'https://skillet.md/docs/versioning';

describe('deprecationHeaders', () => {
  it('uses the bare boolean form when no date is claimed', () => {
    assert.deepEqual(deprecationHeaders({ documentation: DOCS }), [
      ['Deprecation', 'true'],
      ['Link', `<${DOCS}>; rel="deprecation"`],
    ]);
  });

  // RFC 9745 §2: a Date item serializes as `@` followed by integer seconds.
  it('serializes a deprecation date as a structured-field Date', () => {
    const headers = new Map(deprecationHeaders({ since: 1_719_792_000, documentation: DOCS }));
    assert.equal(headers.get('Deprecation'), '@1719792000');
  });

  // RFC 8594 §3: an HTTP-date, never epoch seconds.
  it('serializes a sunset as an IMF-fixdate', () => {
    const headers = new Map(
      deprecationHeaders({ sunset: 1_719_792_000, documentation: DOCS }),
    );
    assert.equal(headers.get('Sunset'), 'Mon, 01 Jul 2024 00:00:00 GMT');
  });

  it('omits Sunset until a removal date exists', () => {
    const names = deprecationHeaders({ documentation: DOCS }).map(([n]) => n);
    assert.equal(names.includes('Sunset'), false);
  });
});

describe('markDeprecated', () => {
  async function reply(setup?: (r: import('fastify').FastifyReply) => void) {
    const app = Fastify({ logger: false });
    app.get('/x', async (_req, r) => {
      setup?.(r);
      markDeprecated(r, { documentation: DOCS, sunset: 1_719_792_000 });
      return { ok: true };
    });
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/x' });
    await app.close();
    return res;
  }

  it('sets all three headers on the response', async () => {
    const res = await reply();
    assert.equal(res.headers['deprecation'], 'true');
    assert.equal(res.headers['sunset'], 'Mon, 01 Jul 2024 00:00:00 GMT');
    assert.equal(res.headers['link'], `<${DOCS}>; rel="deprecation"`);
  });

  // Announcing a deprecation must not cost an unrelated relation.
  it('merges into an existing Link rather than replacing it', async () => {
    const res = await reply((r) => r.header('Link', '<https://skillet.md/next>; rel="successor-version"'));
    const link = String(res.headers['link']);
    assert.match(link, /rel="successor-version"/);
    assert.match(link, /rel="deprecation"/);
  });
});

describe('the retired anonymous signup route', () => {
  it('points at the policy page on the configured site origin', () => {
    const prev = process.env.SKILLET_WEB_URL;
    process.env.SKILLET_WEB_URL = 'https://staging.example.test/';
    assert.equal(deprecationPolicyUrl(), 'https://staging.example.test/docs/versioning');
    if (prev === undefined) delete process.env.SKILLET_WEB_URL;
    else process.env.SKILLET_WEB_URL = prev;
  });

  it('defaults to the canonical origin', () => {
    const prev = process.env.SKILLET_WEB_URL;
    delete process.env.SKILLET_WEB_URL;
    assert.equal(deprecationPolicyUrl(), DOCS);
    if (prev !== undefined) process.env.SKILLET_WEB_URL = prev;
  });
});
