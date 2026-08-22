import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { screenCandidate } from '../src/lib/mirror-screen.js';

/**
 * A screen that cannot REACH a verdict must not produce one.
 *
 * Discovery and the admin approve path both recorded a failed fetch as
 * `rejected_screen`, which is permanent and unretryable. Because the screen
 * authenticated with nothing, GitHub's 60-requests-per-hour anonymous budget
 * ran out within a dozen repos and every candidate after that was thrown away:
 * 240 by the nightly sweeps, then another 6 mid-approval while an admin watched.
 */
function res(status: number, headers: Record<string, string> = {}): Response {
  return new Response(status === 200 ? '{}' : '', { status, headers });
}

const IRRELEVANT = { owner: 'someone', repo: 'something' };

describe('screenCandidate — transient vs verdict', () => {
  it('marks a 429 transient, not a rejection', async () => {
    const r = await screenCandidate({ ...IRRELEVANT, fetchImpl: async () => res(429) });
    assert.equal(r.pass, false);
    assert.equal(r.transient, true);
    assert.match(r.notes ?? '', /not a judgement on the repo/);
  });

  it('marks a rate-limited 403 transient', async () => {
    const r = await screenCandidate({
      ...IRRELEVANT,
      fetchImpl: async () => res(403, { 'x-ratelimit-remaining': '0' }),
    });
    assert.equal(r.transient, true);
  });

  it('marks a 5xx and a network error transient', async () => {
    const server = await screenCandidate({ ...IRRELEVANT, fetchImpl: async () => res(503) });
    assert.equal(server.transient, true);
    const network = await screenCandidate({
      ...IRRELEVANT,
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    });
    assert.equal(network.transient, true);
  });

  // The distinction has to cut both ways, or "transient" just means "failed".
  it('keeps a 404 a real verdict', async () => {
    const r = await screenCandidate({ ...IRRELEVANT, fetchImpl: async () => res(404) });
    assert.equal(r.pass, false);
    assert.notEqual(r.transient, true);
    assert.match(r.notes ?? '', /private or deleted/);
  });

  it('keeps a plain 403 with no rate-limit signal a real verdict', async () => {
    const r = await screenCandidate({ ...IRRELEVANT, fetchImpl: async () => res(403) });
    assert.notEqual(r.transient, true);
  });
});

describe('screenCandidate — authentication', () => {
  // The root cause: nothing in the module ever read a token, so every request
  // went out anonymous while SKILLET_DISCOVERY_GITHUB_TOKEN sat at 5000/5000.
  it('sends the discovery token when one is configured', async () => {
    const prev = process.env.SKILLET_DISCOVERY_GITHUB_TOKEN;
    process.env.SKILLET_DISCOVERY_GITHUB_TOKEN = 'ghp_test_token';
    let seen: string | null = null;
    try {
      await screenCandidate({
        ...IRRELEVANT,
        fetchImpl: async (_url, init) => {
          seen = new Headers(init?.headers).get('authorization');
          return res(404);
        },
      });
    } finally {
      if (prev === undefined) delete process.env.SKILLET_DISCOVERY_GITHUB_TOKEN;
      else process.env.SKILLET_DISCOVERY_GITHUB_TOKEN = prev;
    }
    assert.equal(seen, 'Bearer ghp_test_token');
  });
});
