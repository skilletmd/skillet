import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { assertDevAuthNotInProduction, buildServer, resolveDevAuth } from '../src/server.js';

describe('resolveDevAuth is fail-closed (dev auth off by default)', () => {
  it('is OFF on the MySQL/Prisma path with NODE_ENV unset and no flag', () => {
    // The pre-fix fail-open: usePrismaAuth (always true in prod) + non-production
    // NODE_ENV enabled dev auth. resolveDevAuth ignores both signals now.
    assert.equal(resolveDevAuth({ dbPath: 'mysql://…' }, {}), false);
  });
  it('is OFF for any non-production NODE_ENV string without the flag', () => {
    assert.equal(resolveDevAuth({ dbPath: 'mysql://…' }, { NODE_ENV: 'staging' }), false);
    assert.equal(resolveDevAuth({ dbPath: 'mysql://…' }, { NODE_ENV: 'prod' }), false);
    assert.equal(resolveDevAuth({ dbPath: 'mysql://…' }, { NODE_ENV: '' }), false);
  });
  it('is ON only for :memory: (tests) or the explicit flag', () => {
    assert.equal(resolveDevAuth({ dbPath: ':memory:' }, {}), true);
    assert.equal(resolveDevAuth({ dbPath: 'mysql://…' }, { SKILLET_ENABLE_DEV_AUTH: '1' }), true);
  });
  it('honors the programmatic opt over env (both directions)', () => {
    assert.equal(resolveDevAuth({ authDevAuth: true }, {}), true);
    assert.equal(
      resolveDevAuth({ authDevAuth: false }, { SKILLET_ENABLE_DEV_AUTH: '1' }),
      false,
    );
  });
});

describe('assertDevAuthNotInProduction', () => {
  it('throws when the dev-auth flag is set in production', () => {
    assert.throws(
      () =>
        assertDevAuthNotInProduction({
          NODE_ENV: 'production',
          SKILLET_ENABLE_DEV_AUTH: '1',
        }),
      /must never run in production/,
    );
  });

  it('allows production without the flag', () => {
    assert.doesNotThrow(() =>
      assertDevAuthNotInProduction({ NODE_ENV: 'production' }),
    );
    assert.doesNotThrow(() =>
      assertDevAuthNotInProduction({ NODE_ENV: 'production', SKILLET_ENABLE_DEV_AUTH: '0' }),
    );
  });

  it('allows the flag outside production (local dev)', () => {
    assert.doesNotThrow(() =>
      assertDevAuthNotInProduction({ NODE_ENV: 'development', SKILLET_ENABLE_DEV_AUTH: '1' }),
    );
    assert.doesNotThrow(() =>
      assertDevAuthNotInProduction({ SKILLET_ENABLE_DEV_AUTH: '1' }),
    );
  });
});

describe('buildServer refuses to boot on the prod + dev-auth combo', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevFlag = process.env.SKILLET_ENABLE_DEV_AUTH;
  afterEach(() => {
    if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevNodeEnv;
    if (prevFlag === undefined) delete process.env.SKILLET_ENABLE_DEV_AUTH;
    else process.env.SKILLET_ENABLE_DEV_AUTH = prevFlag;
  });

  it('rejects rather than encrypting real tokens under a dev key', async () => {
    process.env.NODE_ENV = 'production';
    process.env.SKILLET_ENABLE_DEV_AUTH = '1';
    await assert.rejects(
      buildServer({ dbPath: ':memory:', logger: false }),
      /must never run in production/,
    );
  });
});
