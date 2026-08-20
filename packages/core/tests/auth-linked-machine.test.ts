import { describe, it, expect } from 'vitest';
import { isLinkedMachineCredentials } from '../src/auth-token.js';
import type { DeviceTokenFile } from '../src/device-token.js';

describe('isLinkedMachineCredentials', () => {
  const pairedDevice: DeviceTokenFile = {
    device_token: 'skillet_d_abc',
    device_id: 'dev-1',
    label: "Thiago's MacBook",
    saved_at: new Date().toISOString(),
  };

  it('is true for pair-claimed device plus session', () => {
    expect(isLinkedMachineCredentials(pairedDevice, 'skillet_s_xyz')).toBe(true);
  });

  it('is true regardless of device label', () => {
    expect(
      isLinkedMachineCredentials(
        { ...pairedDevice, label: 'anonymous' },
        'skillet_s_xyz',
      ),
    ).toBe(true);
    expect(
      isLinkedMachineCredentials({ ...pairedDevice, label: undefined }, 'skillet_s_xyz'),
    ).toBe(true);
  });

  it('is false without session', () => {
    expect(isLinkedMachineCredentials(pairedDevice, '')).toBe(false);
  });
});
