import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeText, decodeTextForScan } from '../src/scanner/text-files.js';
import { isExtensionlessInstructionPath } from '../src/scanner/file-classes.js';

describe('scan decode policy', () => {
  it('decodeText tolerates invalid UTF-8 with replacement', () => {
    const bytes = new Uint8Array([0x68, 0x69, 0xff, 0x21]);
    const out = decodeText(bytes);
    assert.ok(out.includes('\uFFFD'));
  });

  it('decodeTextForScan throws on invalid UTF-8', () => {
    const bytes = new Uint8Array([0x68, 0x69, 0xff, 0x21]);
    assert.throws(() => decodeTextForScan(bytes));
  });

  it('treats extensionless agents paths as detector-covered', () => {
    assert.equal(isExtensionlessInstructionPath('agents/reviewer'), true);
    assert.equal(isExtensionlessInstructionPath('references/notes'), true);
    assert.equal(isExtensionlessInstructionPath('scripts/run'), false);
  });
});
