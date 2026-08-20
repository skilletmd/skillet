/**
 * `skillet auth connect` — mint a user-bound device token for this machine/agent.
 */
import { loadSessionToken } from '../session-token.js';
import { saveDeviceToken } from '../device-token.js';
import { defaultMachineLabel } from '../machine-label.js';
import { REGISTRY_URL_DEFAULT } from '../kit/types.js';
import { REGISTRY_API } from '../registry-api.js';

export interface AuthConnectOptions {
  registryUrl?: string;
  token?: string;
  label?: string;
  fetchImpl?: typeof fetch;
}

export interface AuthConnectResult {
  device_id: string;
  device_token: string;
}

export async function authConnect(opts: AuthConnectOptions = {}): Promise<AuthConnectResult> {
  const session = await loadSessionToken(opts.token);
  if (!session || !session.startsWith('skillet_s_')) {
    throw new Error('A signed-in session is required. Run `skillet connect <code>` first.');
  }

  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const label = (opts.label ?? defaultMachineLabel()).slice(0, 80);

  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/devices/token`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${session}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ label }),
  });

  const body = (await res.json().catch(() => null)) as {
    device_id?: string;
    device_token?: string;
    message?: string;
  } | null;

  if (!res.ok || !body?.device_token || !body.device_id) {
    const msg =
      body && typeof body === 'object' && 'message' in body
        ? String(body.message)
        : `HTTP ${res.status}`;
    throw new Error(`Could not mint device token: ${msg}`);
  }

  await saveDeviceToken(body.device_token, { device_id: body.device_id, label });

  return { device_id: body.device_id, device_token: body.device_token };
}
