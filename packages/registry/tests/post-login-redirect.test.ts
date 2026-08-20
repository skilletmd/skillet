// U2 — postLoginRedirect only ever redirects to the configured web origin.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { postLoginRedirect } from '../src/routes/auth.js';

describe('postLoginRedirect (U2 open-redirect)', () => {
  beforeEach(() => {
    process.env['SKILLET_WEB_URL'] = 'https://skillet.md';
  });
  afterEach(() => {
    delete process.env['SKILLET_WEB_URL'];
  });

  it('returns a same-origin returnTo as-is', () => {
    assert.equal(postLoginRedirect('https://skillet.md/settings'), 'https://skillet.md/settings');
  });

  it('rejects a foreign-host returnTo → safe fallback', () => {
    assert.equal(postLoginRedirect('https://evil.example/steal'), 'https://skillet.md/auth/done');
  });

  it('rejects a look-alike host (no startsWith bypass) → fallback', () => {
    assert.equal(postLoginRedirect('https://skillet.md.evil.example'), 'https://skillet.md/auth/done');
  });

  it('rejects a malformed returnTo without throwing → fallback', () => {
    assert.equal(postLoginRedirect('not a url'), 'https://skillet.md/auth/done');
  });

  it('null/absent returnTo → fallback', () => {
    assert.equal(postLoginRedirect(null), 'https://skillet.md/auth/done');
    assert.equal(postLoginRedirect(), 'https://skillet.md/auth/done');
  });

  it('no SKILLET_WEB_URL → relative /auth/done', () => {
    delete process.env['SKILLET_WEB_URL'];
    assert.equal(postLoginRedirect('https://skillet.md/x'), '/auth/done');
  });
});
