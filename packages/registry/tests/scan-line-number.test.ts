import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLineStarts, lineNumber, lineNumberAt } from '../src/scanner/detectors/util.js';

describe('scan line attribution', () => {
  it('maps offsets to 1-indexed line numbers', () => {
    const contents = 'alpha\nbeta\ngamma\n';
    const starts = buildLineStarts(contents);
    assert.equal(lineNumberAt(starts, 0), 1);
    assert.equal(lineNumberAt(starts, 6), 2);
    assert.equal(lineNumberAt(starts, 11), 3);
    assert.equal(lineNumber(contents, 11), 3);
  });

  it('handles empty content', () => {
    const starts = buildLineStarts('');
    assert.equal(lineNumberAt(starts, 0), 1);
  });
});
