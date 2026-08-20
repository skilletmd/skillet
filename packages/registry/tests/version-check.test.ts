import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertNodeVersion } from '../src/version-check.js';

describe('assertNodeVersion', () => {
  it('passes on Node 24+', () => {
    assert.doesNotThrow(() => assertNodeVersion('v24.16.0'));
    assert.doesNotThrow(() => assertNodeVersion('v25.0.0'));
  });

  it('throws below Node 24 with an actionable message', () => {
    assert.throws(() => assertNodeVersion('v22.14.0'), /requires Node >= 24/);
    assert.throws(() => assertNodeVersion('v20.0.0'), /requires Node >= 24/);
  });

  it('throws on an unparseable version', () => {
    assert.throws(() => assertNodeVersion('garbage'), /requires Node >= 24/);
  });
});
