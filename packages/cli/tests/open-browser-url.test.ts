import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeBrowserUrl, resolveWebUrl } from '../src/open-browser-url.js';

describe('resolveWebUrl', () => {
  // Derive the base from the function itself so the assertions hold regardless
  // of whether SKILLET_WEB_URL is set in the environment.
  const base = resolveWebUrl();

  it('normalizes a bare path to the rooted form', () => {
    assert.equal(resolveWebUrl('settings'), `${base}/settings`);
    assert.equal(resolveWebUrl('skills/new'), `${base}/skills/new`);
  });

  it('accepts an already-rooted path unchanged', () => {
    assert.equal(resolveWebUrl('/settings'), `${base}/settings`);
  });

  it('returns the base for an empty or absent path', () => {
    assert.equal(resolveWebUrl(), base);
    assert.equal(resolveWebUrl(''), base);
  });

  it('rejects a protocol-relative path', () => {
    assert.throws(() => resolveWebUrl('//evil.com'), /site-relative/);
  });
});

describe('assertSafeBrowserUrl', () => {
  it('accepts https URLs', () => {
    assert.doesNotThrow(() => assertSafeBrowserUrl('https://skillet.md/login'));
  });

  it('rejects URLs with double quotes', () => {
    assert.throws(() => assertSafeBrowserUrl('https://evil.com/"'), /unsafe/);
  });

  it('rejects non-http schemes', () => {
    assert.throws(() => assertSafeBrowserUrl('javascript:alert(1)'));
  });
});
