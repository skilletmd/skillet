import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RESERVED_HANDLES, isReservedHandle } from '../src/reserved-handles.js';

describe('reserved handles', () => {
  it('reserves brand, authority, and route names', () => {
    for (const h of ['skillet', 'admin', 'support', 'official', 'api', 'settings', 'noreply', 'create']) {
      assert.equal(isReservedHandle(h), true, h);
    }
  });

  it('is case-insensitive and trims', () => {
    assert.equal(isReservedHandle('ADMIN'), true);
    assert.equal(isReservedHandle('  Skillet  '), true);
  });

  it('allows ordinary handles', () => {
    for (const h of ['taylor', 'ada', 'skillet-fan', 'admin2', 'team-rocket', 'apiary', 'springfield']) {
      assert.equal(isReservedHandle(h), false, h);
    }
  });

  // Brand-prefixed authority compounds are an impersonation vector
  // that exact-match alone misses. <brand>(-?)<authority term> is reserved.
  it('reserves brand-prefixed authority compounds (hyphenated and fused)', () => {
    for (const h of [
      'skillet-support',
      'skilletsupport',
      'skillet-team',
      'skillet-official',
      'skillet-security',
      'skillet-admin',
      'skillet-hq',
      'skilletadminsupport',
    ]) {
      assert.equal(isReservedHandle(h), true, h);
    }
  });

  // Repeated hyphens and multi-segment authority compounds.
  it('reserves repeated-hyphen and multi-segment brand authority compounds', () => {
    for (const h of [
      'skillet--support',
      'skillet---admin',
      'skillet-support-team',
      'skillet-help-desk',
    ]) {
      assert.equal(isReservedHandle(h), true, h);
    }
  });

  // The carve-out that keeps the curated list from over-reaching: a brand
  // prefix followed by a non-authority (community) suffix stays claimable.
  it('allows brand-prefixed non-authority compounds', () => {
    for (const h of [
      'skillet-fan',
      'skilletfan',
      'skillet-lover',
      'springfield',
      'skillets',
    ]) {
      assert.equal(isReservedHandle(h), false, h);
    }
  });

  it('every entry is lowercase and a single HANDLE_RE token', () => {
    const handleRe = /^[a-z0-9][a-z0-9-]{0,38}$/;
    for (const h of RESERVED_HANDLES) {
      assert.equal(h, h.toLowerCase(), `not lowercase: ${h}`);
      assert.ok(handleRe.test(h), `not a valid handle token: ${h}`);
    }
  });
});
