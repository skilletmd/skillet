/**
 * Resolve which registry bearer to use for sync and other registry reads.
 *
 * Priority: explicit arg → device.json → session.json / SKILLET_TOKEN env.
 *
 * A device token is only minted by pair-claiming a machine, so any stored
 * device token marks a linked machine. It wins over session so a web
 * disconnect invalidates sync on that machine.
 *
 * Exception: a device file labeled 'anonymous' is a leftover from the retired
 * anonymous-bootstrap path (its registry row is deleted by migration 049). It
 * is not a credential — skip it so an upgrading machine falls through to its
 * session (or to the unpaired gate) instead of syncing with a dangling token
 * and landing in the "disconnected from your account" lane.
 */
import { loadSessionToken } from './session-token.js';
import { readActiveDeviceFile, type DeviceTokenFile } from './device-token.js';

export type RegistryBearerKind = 'session' | 'device' | 'kit' | 'unknown' | 'none';

export function classifyRegistryBearer(token: string): RegistryBearerKind {
  if (token.startsWith('skillet_s_')) return 'session';
  if (token.startsWith('skillet_d_')) return 'device';
  if (token.startsWith('skillet_k_')) return 'kit';
  if (token.length > 0) return 'unknown';
  return 'none';
}

export interface RegistryBearer {
  token: string;
  kind: RegistryBearerKind;
}

/** Pair-claimed machine: device token plus session. */
export function isLinkedMachineCredentials(
  deviceFile: DeviceTokenFile | null,
  sessionToken: string,
): boolean {
  return Boolean(deviceFile?.device_id && deviceFile.device_token && sessionToken.length > 0);
}

/** Load the best available registry bearer for the caller. */
export async function loadRegistryBearer(explicit?: string): Promise<RegistryBearer> {
  if (explicit) {
    const token = explicit;
    return { token, kind: classifyRegistryBearer(token) };
  }

  const deviceFile = await readActiveDeviceFile();
  if (deviceFile?.device_token) {
    return { token: deviceFile.device_token, kind: 'device' };
  }

  const session = await loadSessionToken();
  if (session) {
    return { token: session, kind: classifyRegistryBearer(session) };
  }

  return { token: '', kind: 'none' };
}
