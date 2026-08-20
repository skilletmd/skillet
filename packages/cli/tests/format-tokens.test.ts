import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTokens } from '../src/format-tokens.js';

test('formatTokens matches the web boundary cases', () => {
  assert.equal(formatTokens(840), '~840');
  assert.equal(formatTokens(999), '~999');
  assert.equal(formatTokens(1000), '~1.0K');
  assert.equal(formatTokens(1320), '~1.3K');
  assert.equal(formatTokens(47000), '~47K');
});

test('formatTokens rounds sub-1000 to an integer and drops the decimal at/above 10K', () => {
  assert.equal(formatTokens(0), '~0');
  assert.equal(formatTokens(499.6), '~500');
  assert.equal(formatTokens(9999), '~10.0K');
  assert.equal(formatTokens(10000), '~10K');
  assert.equal(formatTokens(12345), '~12K');
});
