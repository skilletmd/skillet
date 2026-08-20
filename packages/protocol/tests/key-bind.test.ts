import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEY_BIND_POP_PREFIX,
  keyBindPopMessage,
  keyBindPopMessageBytes,
} from '../src/key-bind.js';

describe('key bind PoP message', () => {
  it('uses the skillet wire prefix', () => {
    assert.equal(KEY_BIND_POP_PREFIX, 'skillet-key-bind:v1:');
  });

  it('builds a stable utf8 message', () => {
    const nonce = 'abc123';
    const keyId = 'deadbeef';
    assert.equal(keyBindPopMessage(nonce, keyId), 'skillet-key-bind:v1:abc123:deadbeef');
    assert.equal(
      keyBindPopMessageBytes(nonce, keyId).toString('utf8'),
      'skillet-key-bind:v1:abc123:deadbeef',
    );
  });
});
