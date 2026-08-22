import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { syncAllConnectedReposPrisma } from '../src/sync/connected-repo.js';

/**
 * A connected repo used to sync only when a human connected it or pressed
 * refresh — nothing scheduled touched it, while every skill page told visitors
 * the source "Syncs daily". These cover the nightly pass's contract.
 */
function fakePrisma(rows: unknown[], users: Record<string, string | null> = {}) {
  return {
    connected_repos: {
      findMany: async () => rows,
      update: async () => ({}),
    },
    users: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id in users ? { handle: users[where.id] } : null,
    },
  } as never;
}

const blobStore = {} as never;

describe('syncAllConnectedReposPrisma', () => {
  it('skips a row with no stored token instead of failing the run', async () => {
    const s = await syncAllConnectedReposPrisma(
      fakePrisma([
        { id: '1', user_id: 'u1', owner: 'o', repo: 'r', token_enc: null, selected_dirs: null, as_kit: 1, publish_as: null },
      ]),
      { blobStore },
    );
    assert.equal(s.synced, 0);
    assert.equal(s.failed, 0);
    assert.equal(s.skipped, 1);
    assert.deepEqual(s.repos, [{ repo: 'o/r', status: 'no_token' }]);
  });

  it('skips a row whose owner has no handle', async () => {
    const s = await syncAllConnectedReposPrisma(
      fakePrisma(
        [{ id: '1', user_id: 'u1', owner: 'o', repo: 'r', token_enc: 'x', selected_dirs: null, as_kit: 1, publish_as: null }],
        { u1: null },
      ),
      { blobStore },
    );
    assert.equal(s.repos[0]?.status, 'no_handle');
  });

  // Fail-soft is the point: one user's revoked token must not stop everyone
  // else's source from staying current.
  it('keeps going after one repo throws', async () => {
    const rows = [
      { id: '1', user_id: 'u1', owner: 'a', repo: 'x', token_enc: null, selected_dirs: null, as_kit: 1, publish_as: null },
      { id: '2', user_id: 'u2', owner: 'b', repo: 'y', token_enc: null, selected_dirs: null, as_kit: 1, publish_as: null },
    ];
    const prisma = fakePrisma(rows);
    // Make the first row explode inside the shared path.
    (prisma as unknown as { users: { findUnique: unknown } }).users = {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id === 'u1') throw new Error('boom');
        return { handle: 'someone' };
      },
    };
    rows[0]!.token_enc = 'x';
    rows[1]!.token_enc = null;
    const s = await syncAllConnectedReposPrisma(prisma, { blobStore });
    assert.equal(s.failed, 1, 'first row counted as failed');
    assert.equal(s.skipped, 1, 'second row still processed');
    assert.equal(s.repos.length, 2);
  });

  it('reports an empty run cleanly', async () => {
    const s = await syncAllConnectedReposPrisma(fakePrisma([]), { blobStore });
    assert.deepEqual(s, { synced: 0, failed: 0, skipped: 0, repos: [] });
  });
});
