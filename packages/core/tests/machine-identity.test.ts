import { describe, expect, it } from 'vitest';
import { deriveMachineId, stableMachineId } from '../src/machine-identity.js';

describe('deriveMachineId', () => {
  it('produces a stable 64-char lowercase hex digest', () => {
    const digest = deriveMachineId('4C4C4544-0032-3510-8058-B4C04F395932');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(deriveMachineId('4C4C4544-0032-3510-8058-B4C04F395932')).toBe(digest);
  });

  it('ignores whitespace and case differences in the raw id', () => {
    const canonical = deriveMachineId('abc123-def456');
    expect(deriveMachineId('  ABC123-DEF456\n')).toBe(canonical);
    expect(deriveMachineId('abc123-def456 ')).toBe(canonical);
  });

  it('never emits the raw id in the digest', () => {
    const raw = 'e88ef167a5d54d3ab469a95f58bd983f';
    expect(deriveMachineId(raw)).not.toContain(raw);
  });

  it('yields different digests for different raw ids', () => {
    expect(deriveMachineId('machine-a')).not.toBe(deriveMachineId('machine-b'));
  });

  it('returns null for missing, empty, and uninitialized ids', () => {
    expect(deriveMachineId(null)).toBeNull();
    expect(deriveMachineId(undefined)).toBeNull();
    expect(deriveMachineId('')).toBeNull();
    expect(deriveMachineId('   \n')).toBeNull();
    expect(deriveMachineId('uninitialized\n')).toBeNull();
    expect(deriveMachineId('UNINITIALIZED')).toBeNull();
  });
});

describe('stableMachineId', () => {
  it('returns a valid digest or null without throwing', () => {
    const id = stableMachineId();
    if (id !== null) {
      expect(id).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(stableMachineId()).toBe(id);
  });
});
