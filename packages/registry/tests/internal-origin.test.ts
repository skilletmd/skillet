import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseInternalOriginAllowlist,
  isInternalOnlyPath,
} from '../src/auth/internal-origin.js';

describe('internal-origin allowlist', () => {
  it('returns null when unset/empty (no origin lock; relies on the signing secret)', () => {
    for (const raw of [undefined, null, '', '  ', ',']) {
      assert.equal(parseInternalOriginAllowlist(raw), null, `raw=${JSON.stringify(raw)}`);
    }
  });

  it('an explicit allowlist admits only listed peers (checked against the TCP peer)', () => {
    const al = parseInternalOriginAllowlist('10.0.0.0/8, 192.168.1.5, ::1');
    assert.ok(al);
    assert.equal(al.allows('10.4.4.4'), true);
    assert.equal(al.allows('192.168.1.5'), true);
    assert.equal(al.allows('::1'), true);
    assert.equal(al.allows('::ffff:10.0.0.5'), true, 'IPv4-mapped form normalizes');
    assert.equal(al.allows('203.0.113.7'), false);
  });

  it('fails closed on a missing/unparseable peer address', () => {
    const al = parseInternalOriginAllowlist('10.0.0.0/8');
    assert.ok(al);
    assert.equal(al.allows(undefined), false);
    assert.equal(al.allows(null), false);
    assert.equal(al.allows('not-an-ip'), false);
  });

  it('throws loudly on a malformed entry (typo fails at boot, not silently)', () => {
    assert.throws(() => parseInternalOriginAllowlist('10.0.0.0/8, garbage'), /Invalid IP/);
    assert.throws(() => parseInternalOriginAllowlist('10.0.0.0/notanumber'), /Invalid CIDR/);
  });

  it('isInternalOnlyPath matches the act-as-any-account surfaces exactly', () => {
    assert.equal(isInternalOnlyPath('/api/v1/auth/web'), true);
    assert.equal(isInternalOnlyPath('/api/v1/auth/link'), true);
    assert.equal(isInternalOnlyPath('/api/v1/github/repos'), true);
    assert.equal(isInternalOnlyPath('/api/v1/github/repos/123'), true);
    // Sibling BFF-signed GitHub routes are also covered (owned-repos, connect-token).
    assert.equal(isInternalOnlyPath('/api/v1/github/owned-repos'), true);
    assert.equal(isInternalOnlyPath('/api/v1/github/connect-token'), true);
    assert.equal(isInternalOnlyPath('/api/v1/auth/webhook'), false, 'no false prefix match');
    assert.equal(isInternalOnlyPath('/api/v1/skills'), false);
  });
});
