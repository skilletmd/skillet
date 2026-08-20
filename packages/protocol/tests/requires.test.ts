import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RequiresError,
  MAX_REQUIRES_ENTRIES,
  isValidRequiresVersion,
  validateRequires,
} from '../src/requires.js';

describe('validateRequires — empty / absent', () => {
  it('treats undefined and null as no deps', () => {
    assert.deepEqual(validateRequires(undefined), { entries: [], warnings: [] });
    assert.deepEqual(validateRequires(null), { entries: [], warnings: [] });
  });

  it('treats [] as no deps', () => {
    assert.deepEqual(validateRequires([]), { entries: [], warnings: [] });
  });

  it('rejects a non-array', () => {
    assert.throws(() => validateRequires({ skill: '@a/b' }), RequiresError);
  });
});

describe('validateRequires — kinds', () => {
  it('parses each of the four kinds', () => {
    const { entries } = validateRequires([
      { skill: '@taylor/festival-ops', version: '>=5' },
      { agent: 'release-captain', optional: true },
      { tool: 'Bash' },
      { command: 'deploy-checklist' },
    ]);
    assert.equal(entries.length, 4);
    assert.deepEqual(entries[0], {
      kind: 'skill',
      target: '@taylor/festival-ops',
      version: '>=5',
      optional: false,
      reason: undefined,
    });
    assert.equal(entries[1]!.kind, 'agent');
    assert.equal(entries[1]!.optional, true);
    assert.equal(entries[2]!.kind, 'tool');
    assert.equal(entries[3]!.kind, 'command');
  });

  it('rejects an entry with no kind key', () => {
    assert.throws(() => validateRequires([{ optional: true }]), RequiresError);
  });

  it('rejects an entry with more than one kind key', () => {
    assert.throws(
      () => validateRequires([{ skill: '@a/b', tool: 'Bash' }]),
      RequiresError
    );
  });

  it('rejects a non-mapping entry', () => {
    assert.throws(() => validateRequires(['@a/b']), RequiresError);
    assert.throws(() => validateRequires([null]), RequiresError);
  });

  it('rejects an empty target', () => {
    assert.throws(() => validateRequires([{ tool: '' }]), RequiresError);
  });
});

describe('validateRequires — version', () => {
  it('accepts every valid constraint form', () => {
    for (const v of ['*', 'latest', '0', '5', '>=5', `sha256:${'9'.repeat(64)}`]) {
      assert.equal(isValidRequiresVersion(v), true, v);
    }
  });

  it('rejects invalid constraint forms', () => {
    for (const v of ['^1.0.0', '~2', '>5', '5.0', 'sha256:zz', 'sha1:abc', '']) {
      assert.equal(isValidRequiresVersion(v), false, v);
    }
  });

  it('rejects version on a non-skill dep', () => {
    assert.throws(
      () => validateRequires([{ tool: 'Bash', version: '5' }]),
      RequiresError
    );
  });

  it('rejects an invalid version on a skill dep', () => {
    assert.throws(
      () => validateRequires([{ skill: '@a/b', version: '^1.0.0' }]),
      RequiresError
    );
  });
});

describe('validateRequires — skill refs', () => {
  it('rejects a non-canonical skill ref', () => {
    for (const bad of ['taylor/festival', '@taylor', '@Taylor/Ops', 'festival']) {
      assert.throws(() => validateRequires([{ skill: bad }]), RequiresError, bad);
    }
  });

  it('rejects a self-dependency', () => {
    assert.throws(
      () => validateRequires([{ skill: '@me/mine' }], '@me/mine'),
      RequiresError
    );
  });

  it('allows the same ref when no selfRef is supplied', () => {
    const { entries } = validateRequires([{ skill: '@me/mine' }]);
    assert.equal(entries.length, 1);
  });
});

describe('validateRequires — caps and shape', () => {
  it('rejects more than the entry cap', () => {
    const many = Array.from({ length: MAX_REQUIRES_ENTRIES + 1 }, () => ({
      tool: 'Bash',
    }));
    assert.throws(() => validateRequires(many), RequiresError);
  });

  it('rejects an over-long reason', () => {
    assert.throws(
      () => validateRequires([{ tool: 'Bash', reason: 'x'.repeat(281) }]),
      RequiresError
    );
  });

  it('rejects a non-boolean optional', () => {
    assert.throws(
      () => validateRequires([{ tool: 'Bash', optional: 'yes' }]),
      RequiresError
    );
  });

  it('warns (does not reject) on unknown keys', () => {
    const { entries, warnings } = validateRequires([
      { tool: 'Bash', futureKey: 1 },
    ]);
    assert.equal(entries.length, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0]!, /futureKey/);
  });
});
