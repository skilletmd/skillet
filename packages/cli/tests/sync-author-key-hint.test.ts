import assert from 'node:assert/strict';
import test from 'node:test';
import { renderFailedPullLine, authorKeyMismatchHandles } from '../src/sync-author-key-hint.js';

test('renderFailedPullLine adds recovery hints for author_key_changed', () => {
  const oldId = 'b'.repeat(64);
  const newId = 'c'.repeat(64);
  const lines = renderFailedPullLine({
    slug: '@thiago/the-lazy-dm',
    status: 'failed',
    reason: `key_id_mismatch: author_key_changed: handle thiago pinned to ${oldId}, registry served ${newId}`,
    authorKeyMismatch: {
      handle: 'thiago',
      pinnedKeyId: oldId,
      servedKeyId: newId,
    },
  });
  assert.match(lines.join('\n'), /skillet pin accept thiago/);
  assert.match(lines.join('\n'), /@thiago\/the-lazy-dm/);
});

test('authorKeyMismatchHandles deduplicates handles', () => {
  const oldId = 'b'.repeat(64);
  const newId = 'c'.repeat(64);
  const mismatch = {
    handle: 'thiago',
    pinnedKeyId: oldId,
    servedKeyId: newId,
  };
  const handles = authorKeyMismatchHandles([
    { slug: '@thiago/a', status: 'failed', authorKeyMismatch: mismatch },
    { slug: '@thiago/b', status: 'failed', authorKeyMismatch: mismatch },
  ]);
  assert.deepEqual(handles, ['thiago']);
});
