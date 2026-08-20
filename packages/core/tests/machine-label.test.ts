import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultMachineLabel } from '../src/machine-label.js';

describe('defaultMachineLabel', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a non-empty label up to 80 characters', () => {
    const label = defaultMachineLabel();
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(80);
    expect(label).not.toBe('cli-device');
  });

  it('prefers COMPUTERNAME when set on non-macOS', () => {
    if (process.platform === 'darwin') return;
    vi.stubEnv('COMPUTERNAME', "Thiago's Macbook");
    expect(defaultMachineLabel()).toBe("Thiago's Macbook");
  });

  it('prefers HOSTNAME when COMPUTERNAME is unset on non-macOS', () => {
    if (process.platform === 'darwin') return;
    vi.stubEnv('HOSTNAME', 'dev-box');
    delete process.env['COMPUTERNAME'];
    expect(defaultMachineLabel()).toBe('dev-box');
  });
});
