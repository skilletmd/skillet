// Pagination offset/limit clamping.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clampInt, MAX_PAGE_OFFSET } from '../src/lib/pagination.js';

describe('clampInt / MAX_PAGE_OFFSET', () => {
  it('clamps a huge offset to the max (bounds the SQL LIMIT)', () => {
    assert.equal(clampInt('999999999', 0, 0, MAX_PAGE_OFFSET), MAX_PAGE_OFFSET);
  });

  it('clamps a negative offset up to the min', () => {
    assert.equal(clampInt('-5', 0, 0, MAX_PAGE_OFFSET), 0);
  });

  it('passes a normal offset through unchanged', () => {
    assert.equal(clampInt('20', 0, 0, MAX_PAGE_OFFSET), 20);
  });

  it('falls back to the default for missing or non-numeric input', () => {
    assert.equal(clampInt(undefined, 0, 0, MAX_PAGE_OFFSET), 0);
    assert.equal(clampInt('abc', 0, 0, MAX_PAGE_OFFSET), 0);
  });

  it('MAX_PAGE_OFFSET is a sane finite bound', () => {
    assert.ok(Number.isFinite(MAX_PAGE_OFFSET) && MAX_PAGE_OFFSET <= 100_000);
  });
});
