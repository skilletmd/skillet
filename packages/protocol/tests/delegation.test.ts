// Conformance for the shared delegation cert/revocation contract.
//
// This is the single source of truth the CLI and the registry
// (verify) both depend on. The byte output of canonicalJson — and therefore the
// signed certHash — MUST be stable and independent of object key insertion
// order. If any of these vectors change, every previously-issued delegation
// signature would silently break, so they are pinned here on purpose.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalJson,
  delegationCertHash,
  revocationHash,
  validateDelegationCert,
  MAX_DELEGATION_TTL_SEC,
  DELEGABLE_SCOPES,
  type DelegationCert,
  type RevocationStatement,
} from '../src/delegation.js';

// Fixed 32-byte device pub so the vectors are deterministic AND satisfy
// device_key_id == hex(device_pub).
const DEVICE_RAW = Buffer.alloc(32, 0x07);
const DEVICE_PUB_B64 = DEVICE_RAW.toString('base64');
const DEVICE_KEY_ID = DEVICE_RAW.toString('hex');

const CERT: DelegationCert = {
  v: 1,
  typ: 'skillet-delegation',
  author_key_id: 'a'.repeat(64),
  handle: 'sarah',
  device_key_id: DEVICE_KEY_ID,
  device_pub: DEVICE_PUB_B64,
  scopes: ['propose', 'approve'],
  issued_at: 1739000000,
  expires_at: 1746776000,
  nonce: 'c'.repeat(32),
};

describe('delegation canonicalization', () => {
  it('sorts object keys lexicographically and emits no whitespace', () => {
    const out = canonicalJson(CERT);
    assert.equal(
      out,
      '{"author_key_id":"' +
        'a'.repeat(64) +
        '","device_key_id":"' +
        DEVICE_KEY_ID +
        '","device_pub":"' +
        DEVICE_PUB_B64 +
        '","expires_at":1746776000,"handle":"sarah","issued_at":1739000000,' +
        '"nonce":"' +
        'c'.repeat(32) +
        '","scopes":["propose","approve"],"typ":"skillet-delegation","v":1}',
    );
  });

  it('is independent of key insertion order', () => {
    const shuffled = {
      nonce: CERT.nonce,
      v: CERT.v,
      scopes: CERT.scopes,
      device_pub: CERT.device_pub,
      typ: CERT.typ,
      expires_at: CERT.expires_at,
      handle: CERT.handle,
      device_key_id: CERT.device_key_id,
      issued_at: CERT.issued_at,
      author_key_id: CERT.author_key_id,
    } as DelegationCert;
    assert.equal(canonicalJson(shuffled), canonicalJson(CERT));
    assert.equal(delegationCertHash(shuffled), delegationCertHash(CERT));
  });

  it('produces a sha256:<64hex> cert hash', () => {
    assert.match(delegationCertHash(CERT), /^sha256:[0-9a-f]{64}$/);
  });

  it('hashes a revocation over a disjoint domain (distinct typ)', () => {
    const rev: RevocationStatement = {
      v: 1,
      typ: 'skillet-delegation-revocation',
      author_key_id: CERT.author_key_id,
      device_key_id: CERT.device_key_id,
      revoked_at: 1746000000,
      nonce: 'd'.repeat(32),
    };
    assert.match(revocationHash(rev), /^sha256:[0-9a-f]{64}$/);
    assert.notEqual(revocationHash(rev), delegationCertHash(CERT));
  });

  it('rejects non-finite numbers rather than coercing them into signed bytes', () => {
    assert.throws(() => canonicalJson({ x: Infinity }), /non-finite/);
  });
});

describe('validateDelegationCert', () => {
  it('accepts a well-formed cert', () => {
    const r = validateDelegationCert(CERT);
    assert.ok('ok' in r && r.ok);
  });

  it('rejects a non-delegable scope', () => {
    const r = validateDelegationCert({ ...CERT, scopes: ['claim'] });
    assert.deepEqual('code' in r && r.code, 'invalid_scope');
  });

  it('rejects device_key_id != hex(device_pub)', () => {
    const r = validateDelegationCert({ ...CERT, device_key_id: 'f'.repeat(64) });
    assert.deepEqual('code' in r && r.code, 'invalid_device_key');
  });

  it('rejects a TTL above the cap', () => {
    const r = validateDelegationCert({
      ...CERT,
      issued_at: 1000,
      expires_at: 1000 + MAX_DELEGATION_TTL_SEC + 1,
    });
    assert.deepEqual('code' in r && r.code, 'invalid_expiry');
  });

  it('only ever allows propose/approve/publish scopes', () => {
    assert.deepEqual([...DELEGABLE_SCOPES], ['propose', 'approve', 'publish']);
  });
});
