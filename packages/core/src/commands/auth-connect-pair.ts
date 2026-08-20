/**
 * `skillet connect <code>` — redeem a web pair code for session + device tokens.
 */
import { randomUUID } from 'node:crypto';
import { extractPairCode } from '../pair-code.js';
import { saveSessionToken } from '../session-token.js';
import { readDeviceFile, readStoredMachineId, saveDeviceToken } from '../device-token.js';
import { defaultMachineLabel } from '../machine-label.js';
import { stableMachineId } from '../machine-identity.js';
import { REGISTRY_URL_DEFAULT } from '../kit/types.js';
import { REGISTRY_API } from '../registry-api.js';

export type ClientPlatform = 'macos' | 'windows';

export interface AuthConnectPairOptions {
  code: string;
  registryUrl?: string;
  label?: string;
  /** How this machine is joining: terminal CLI vs desktop menubar app. */
  clientKind?: 'cli' | 'desktop';
  fetchImpl?: typeof fetch;
}

/** Map Node's process.platform to registry client_platform for desktop pairs. */
export function clientPlatformFromProcess(
  platform: string = process.platform,
): ClientPlatform | undefined {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return undefined;
}

export interface AuthConnectPairResult {
  device_id: string;
  device_token: string;
  session_token: string;
  handle: string | null;
  user_id: string;
  /** Machine label this device row was registered under (user-supplied or OS-derived). */
  label: string;
}

export async function authConnectPair(
  opts: AuthConnectPairOptions,
): Promise<AuthConnectPairResult> {
  const code = extractPairCode(opts.code);
  if (!code) {
    throw new Error('Pair code must be 8 characters (letters and numbers).');
  }

  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const label = (opts.label ?? defaultMachineLabel()).slice(0, 80);
  const clientKind = opts.clientKind ?? 'cli';
  const clientPlatform =
    clientKind === 'desktop' ? clientPlatformFromProcess() : undefined;

  // Present this machine's existing device identity (a prior pairing) so the
  // registry rebinds that device instead of minting a duplicate — re-pairing
  // the same machine never spawns a second device row.
  // A token from a different registry simply won't match and is ignored there;
  // machine_id is the fallback the registry reclaims by when the token is
  // lost or clobbered (same-account only). Derived from the OS machine
  // identity so it survives sign-out, wipes, and fresh SKILLET_DIRs; the
  // stored id covers machines whose OS id is unreadable, and a random UUID is
  // the last resort (persisted via saveDeviceToken below).
  const existingDevice = await readDeviceFile().catch(() => null);
  const storedMachineId = await readStoredMachineId().catch(() => undefined);
  const machineId = stableMachineId() ?? storedMachineId ?? randomUUID();

  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/connect/claim`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      code,
      label,
      client_kind: clientKind,
      ...(clientPlatform ? { client_platform: clientPlatform } : {}),
      ...(existingDevice?.device_token ? { device_token: existingDevice.device_token } : {}),
      machine_id: machineId,
    }),
  });

  const body = (await res.json().catch(() => null)) as {
    session_token?: string;
    device_id?: string;
    device_token?: string;
    handle?: string | null;
    user_id?: string;
    message?: string;
    error?: string;
  } | null;

  if (!res.ok || !body?.session_token || !body.device_token || !body.device_id || !body.user_id) {
    const msg =
      body && typeof body === 'object' && 'message' in body && body.message
        ? String(body.message)
        : body?.error
          ? String(body.error)
          : `HTTP ${res.status}`;
    throw new Error(`Could not connect with pair code: ${msg}`);
  }

  await saveSessionToken(body.session_token);
  await saveDeviceToken(body.device_token, {
    device_id: body.device_id,
    label,
    machine_id: machineId,
  });

  return {
    session_token: body.session_token,
    device_id: body.device_id,
    device_token: body.device_token,
    handle: body.handle ?? null,
    user_id: body.user_id,
    label,
  };
}
