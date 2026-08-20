// Repo-token encryption key handling — fail closed.
//
// Connected GitHub OAuth tokens are encrypted at rest. The key must be provided
// explicitly; a missing key fails closed instead of silently falling back to a
// source-readable dev key. The deterministic dev key is reachable ONLY under
// the explicit SKILLET_ENABLE_DEV_AUTH=1 gate — never on NODE_ENV alone.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { encryptToken, decryptToken } from '../src/sync/repo-auth.js';

const KEYS = ['SKILLET_REPO_TOKEN_KEY', 'SKILLET_ENABLE_DEV_AUTH', 'NODE_ENV'];

describe('repo-token encryption key (finding 4)', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('round-trips with an explicit key', () => {
    process.env.SKILLET_REPO_TOKEN_KEY = 'a-real-key';
    const enc = encryptToken('gho_secret');
    assert.equal(decryptToken(enc), 'gho_secret');
  });

  it('throws when no key is set and dev-auth is off', () => {
    assert.throws(() => encryptToken('gho_secret'), /REPO_TOKEN_KEY/);
  });

  it('NODE_ENV alone does not enable a usable key (still throws)', () => {
    process.env.NODE_ENV = 'development';
    assert.throws(() => encryptToken('gho_secret'), /REPO_TOKEN_KEY/);
  });

  it('uses the deterministic dev key only under SKILLET_ENABLE_DEV_AUTH=1', () => {
    process.env.SKILLET_ENABLE_DEV_AUTH = '1';
    const enc = encryptToken('gho_secret');
    assert.equal(decryptToken(enc), 'gho_secret');
  });
});
