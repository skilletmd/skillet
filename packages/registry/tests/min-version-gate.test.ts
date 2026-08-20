// U4 — minimum-supported-client-version gate. Unit-level (no Fastify boot):
// the route wiring is a one-line call into clientBelowFloor, which carries all
// the branching this test locks down.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clientBelowFloor,
  compareSemver,
  minSupportedVersion,
  upgradeRequiredBody,
} from '../src/lib/min-version.js';

const saved = process.env.SKILLET_MIN_CLIENT_VERSION;
function setFloor(v?: string): void {
  if (v === undefined) delete process.env.SKILLET_MIN_CLIENT_VERSION;
  else process.env.SKILLET_MIN_CLIENT_VERSION = v;
}

describe('min-version gate (U4)', () => {
  afterEach(() => setFloor(saved));

  it('is dormant at the default 0.0.0 floor — any client passes', () => {
    setFloor(undefined);
    assert.equal(minSupportedVersion(), '0.0.0');
    assert.equal(clientBelowFloor('0.1.0'), false);
    assert.equal(clientBelowFloor('0.0.0'), false);
    assert.equal(clientBelowFloor(undefined), false);
  });

  it('blocks a client strictly below an explicit floor', () => {
    setFloor('0.2.0');
    assert.equal(clientBelowFloor('0.1.0'), true);
    assert.equal(clientBelowFloor('0.1.9'), true);
  });

  it('passes a client at or above the floor', () => {
    setFloor('0.2.0');
    assert.equal(clientBelowFloor('0.2.0'), false);
    assert.equal(clientBelowFloor('0.3.0'), false);
    assert.equal(clientBelowFloor('1.0.0'), false);
  });

  it('fails open on a missing or garbled client version', () => {
    setFloor('0.2.0');
    assert.equal(clientBelowFloor(undefined), false);
    assert.equal(clientBelowFloor(''), false);
    assert.equal(clientBelowFloor('not-a-version'), false);
  });

  it('compareSemver orders correctly and is safe on garbage', () => {
    assert.equal(compareSemver('0.1.0', '0.2.0'), -1);
    assert.equal(compareSemver('0.2.0', '0.2.0'), 0);
    assert.equal(compareSemver('1.0.0', '0.9.9'), 1);
    assert.equal(compareSemver('x', '0.2.0'), 0);
  });

  it('upgradeRequiredBody carries the structured signal the desktop parses', () => {
    const body = upgradeRequiredBody('0.2.0');
    assert.equal(body.error, 'client_upgrade_required');
    assert.equal(body.min_version, '0.2.0');
    assert.ok(body.message.length > 0);
  });
});
