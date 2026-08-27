// The copy endpoint is anonymous and unauthenticated, so the shape of what it
// accepts is the only thing standing between it and junk rows. These pin that
// shape, and the ownership rule that stops a caller attributing copies to
// someone else's profile.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isRecordableCopy } from '../src/lib/suggestion-copy-events.js';

describe('isRecordableCopy', () => {
  it('accepts a skill that belongs to the profile it was copied from', () => {
    assert.equal(isRecordableCopy('wshobson', 'wshobson:debugging-strategies'), true);
  });

  it('rejects a skill belonging to a different author', () => {
    // Without this an anonymous caller could credit copies to any profile.
    assert.equal(isRecordableCopy('wshobson', 'cloudflare:wrangler'), false);
  });

  it('is case-insensitive about the ownership match', () => {
    assert.equal(isRecordableCopy('WsHobson', 'wshobson:x'), true);
  });

  it('rejects a ref with no author segment', () => {
    assert.equal(isRecordableCopy('wshobson', 'debugging-strategies'), false);
  });

  it('rejects non-string input', () => {
    assert.equal(isRecordableCopy(null, 'a:b'), false);
    assert.equal(isRecordableCopy('a', 42), false);
    assert.equal(isRecordableCopy(undefined, undefined), false);
  });

  it('rejects empty values', () => {
    assert.equal(isRecordableCopy('', ''), false);
    assert.equal(isRecordableCopy('a', ''), false);
  });

  it('rejects handles and refs carrying path or injection characters', () => {
    assert.equal(isRecordableCopy('../etc', '../etc:x'), false);
    assert.equal(isRecordableCopy('a b', 'a b:x'), false);
    assert.equal(isRecordableCopy('a', 'a:<script>'), false);
  });

  it('rejects an over-long handle or slug rather than truncating it', () => {
    assert.equal(isRecordableCopy('a'.repeat(200), `${'a'.repeat(200)}:x`), false);
    assert.equal(isRecordableCopy('a', `a:${'s'.repeat(400)}`), false);
  });

  it('allows the slug characters real refs use', () => {
    assert.equal(isRecordableCopy('every', 'every:ce-code-review'), true);
    assert.equal(isRecordableCopy('google', 'google:cloud.run'), true);
    assert.equal(isRecordableCopy('a', 'a:nested/path'), true);
  });
});
