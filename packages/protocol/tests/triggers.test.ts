import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TriggersError,
  validateTriggers,
  MAX_TRIGGERS,
  MAX_TRIGGER_CHARS,
} from '../src/triggers.js';

describe('validateTriggers — empty / absent', () => {
  it('accepts undefined and null', () => {
    assert.deepEqual(validateTriggers(undefined), { triggers: [], warnings: [] });
    assert.deepEqual(validateTriggers(null), { triggers: [], warnings: [] });
  });

  it('accepts an empty array', () => {
    assert.deepEqual(validateTriggers([]), { triggers: [], warnings: [] });
  });

  it('rejects non-array values', () => {
    assert.throws(() => validateTriggers('deploy'), TriggersError);
    assert.throws(() => validateTriggers({ cue: 'x' }), TriggersError);
  });
});

describe('validateTriggers — entries', () => {
  it('parses trimmed string cues', () => {
    const { triggers } = validateTriggers([
      ' user asks about deploy ',
      'production release checklist',
    ]);
    assert.deepEqual(triggers, [
      'user asks about deploy',
      'production release checklist',
    ]);
  });

  it('rejects empty strings', () => {
    assert.throws(() => validateTriggers(['']), TriggersError);
    assert.throws(() => validateTriggers(['   ']), TriggersError);
  });

  it('rejects non-string entries', () => {
    assert.throws(() => validateTriggers([123]), TriggersError);
    assert.throws(() => validateTriggers([null]), TriggersError);
  });

  it('rejects over-long cues', () => {
    assert.throws(
      () => validateTriggers(['x'.repeat(MAX_TRIGGER_CHARS + 1)]),
      TriggersError,
    );
  });

  it('rejects too many cues', () => {
    const many = Array.from({ length: MAX_TRIGGERS + 1 }, (_, i) => `cue-${i}`);
    assert.throws(() => validateTriggers(many), TriggersError);
  });

  it('warns on duplicate cues (case-insensitive)', () => {
    const { triggers, warnings } = validateTriggers([
      'Deploy to production',
      'deploy to production',
    ]);
    assert.deepEqual(triggers, ['Deploy to production']);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /duplicate trigger/i);
  });
});
