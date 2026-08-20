import { describe, expect, it } from 'vitest';
import { extractPairCode, isValidPairCode, normalizePairCode } from '../src/pair-code.js';

describe('pair-code', () => {
  it('normalizes case and separators', () => {
    expect(normalizePairCode('99mzgkau')).toBe('99MZGKAU');
    expect(normalizePairCode('99mz-gkau')).toBe('99MZGKAU');
  });

  it('validates the registry alphabet', () => {
    expect(isValidPairCode('99MZGKAU')).toBe(true);
    expect(isValidPairCode('abcd0123')).toBe(false);
  });

  it('extracts a bare code', () => {
    expect(extractPairCode('99mzgkau')).toBe('99MZGKAU');
    expect(extractPairCode('99mz-gkau')).toBe('99MZGKAU');
  });

  it('extracts from a full CLI command paste', () => {
    expect(extractPairCode('npx skilletmd connect 99MZGKAU')).toBe('99MZGKAU');
    expect(extractPairCode('$ npx skilletmd connect 99MZGKAU')).toBe('99MZGKAU');
  });

  it('prefers the code after CONNECT when multiple candidates exist', () => {
    expect(extractPairCode('noise AAAA2345 connect BBBB6789')).toBe('BBBB6789');
  });

  it('returns null for empty or invalid input', () => {
    expect(extractPairCode('')).toBeNull();
    expect(extractPairCode('   ')).toBeNull();
    expect(extractPairCode('abcd0123')).toBeNull();
    expect(extractPairCode('not a code')).toBeNull();
  });
});
