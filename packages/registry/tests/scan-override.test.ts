import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lastCleanHashPrisma } from '../src/lib/sync-manifest.js';

/**
 * A skill whose every version is quarantined has no servable hash, so it cannot
 * be installed. That is correct for a real threat and wrong for security tooling:
 * `garrytan/careful` ("Safety guardrails for destructive commands") quarantined
 * because its own test cases name `rm -rf /`, and `garrytan/cso` because its
 * audit checklist lists `forget your instructions` as a pattern to look for.
 * A guard and a payload carry the same strings, so only a human can separate them.
 */
function db(versions: Array<{ hash: string; status?: string }>, overrideAt: number | null) {
  return {
    skill_versions: {
      findMany: async () => versions.map((v) => ({ hash: v.hash })),
    },
    skill_version_scans: {
      findMany: async () =>
        versions
          .filter((v) => v.status)
          .map((v) => ({ skill_version_id: v.hash, status: v.status })),
    },
    skills: {
      findUnique: async () => ({ scan_override_at: overrideAt }),
    },
  } as never;
}

describe('lastCleanHashPrisma with a scan override', () => {
  it('serves nothing when every version is quarantined and no admin reviewed it', async () => {
    const hash = await lastCleanHashPrisma(
      db([{ hash: 'v2', status: 'quarantined' }, { hash: 'v1', status: 'quarantined' }], null),
      's',
    );
    assert.equal(hash, null);
  });

  it('serves the newest version once an admin has overridden', async () => {
    const hash = await lastCleanHashPrisma(
      db([{ hash: 'v2', status: 'quarantined' }, { hash: 'v1', status: 'quarantined' }], 1_700_000_000),
      's',
    );
    assert.equal(hash, 'v2');
  });

  it('still prefers a genuinely clean version over a quarantined newer one', async () => {
    const hash = await lastCleanHashPrisma(
      db([{ hash: 'v2', status: 'quarantined' }, { hash: 'v1', status: 'clean' }], null),
      's',
    );
    assert.equal(hash, 'v1');
  });

  // The override waives the BLOCK, never the finding. Nothing here clears a scan
  // row, so the trust panel keeps showing exactly what the scanner saw.
  it('has no version to serve when there are none at all', async () => {
    assert.equal(await lastCleanHashPrisma(db([], 1_700_000_000), 's'), null);
  });
});
