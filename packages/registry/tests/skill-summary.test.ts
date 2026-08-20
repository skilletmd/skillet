import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signatureStatusOf, moderationOf, toSkillSummary, type SkillSummaryRow } from '../src/routes/skill-summary.js';

// signatureStatusOf is the read-side trust derivation that decides the "signed"
// badge on the skill page. It re-runs NO crypto — the Ed25519 verify already
// happened, fail-closed, at publish time. Here it only confirms the stored
// signature's key_id still matches the author's currently-registered key, so a
// key rotation/removal correctly downgrades old versions to `unverified`.

const KEY = 'a'.repeat(64);

function row(overrides: Partial<SkillSummaryRow> = {}): SkillSummaryRow {
  return {
    author_id: 'alice',
    slug: 'demo',
    skill_id: 'skl_1',
    description: null,
    visibility: 'public',
    latest_hash: 'sha256:' + 'b'.repeat(64),
    version: 1,
    latest_major: 1,
    latest_minor: 0,
    latest_patch: 0,
    install_count: 0,
    created_at: 0,
    signature_b64: 'c2ln', // "sig"
    signature_key_id: KEY,
    registered_key_id: KEY,
    scan_status: null,
    moderation_status: null,
    category: null,
    ...overrides,
  };
}

describe('signatureStatusOf', () => {
  it('verified when a stored signature key_id matches the registered key', () => {
    assert.equal(signatureStatusOf(row()), 'verified');
  });

  it('unverified after a key rotation (stored key_id no longer matches)', () => {
    assert.equal(
      signatureStatusOf(row({ registered_key_id: 'd'.repeat(64) })),
      'unverified',
    );
  });

  it('unverified for an unsigned legacy version (no signature stored)', () => {
    assert.equal(
      signatureStatusOf(row({ signature_b64: null, signature_key_id: null })),
      'unverified',
    );
  });

  it('unverified when the author has removed their registered key', () => {
    assert.equal(signatureStatusOf(row({ registered_key_id: null })), 'unverified');
  });

  it('unverified when a signature is present but its key_id is missing', () => {
    assert.equal(signatureStatusOf(row({ signature_key_id: null })), 'unverified');
  });
});

describe('moderationOf', () => {
  it('defaults to none when the column is null (legacy / never moderated)', () => {
    assert.equal(moderationOf(row()), 'none');
  });

  it('passes through none / unlisted / quarantined', () => {
    assert.equal(moderationOf(row({ moderation_status: 'none' })), 'none');
    assert.equal(moderationOf(row({ moderation_status: 'unlisted' })), 'unlisted');
    assert.equal(moderationOf(row({ moderation_status: 'quarantined' })), 'quarantined');
  });

  it('falls back to none for an unrecognized value', () => {
    assert.equal(moderationOf(row({ moderation_status: 'bogus' })), 'none');
  });
});

describe('toSkillSummary: deprecated flag', () => {
  it('deprecated is false when deprecated_at is absent (public / non-owner rows)', () => {
    assert.equal(toSkillSummary(row()).deprecated, false);
  });

  it('deprecated is false when deprecated_at is explicitly null', () => {
    assert.equal(toSkillSummary(row({ deprecated_at: null })).deprecated, false);
  });

  it('deprecated is true when deprecated_at carries a timestamp (owner rows)', () => {
    assert.equal(toSkillSummary(row({ deprecated_at: 1_700_000_000 })).deprecated, true);
  });
});
