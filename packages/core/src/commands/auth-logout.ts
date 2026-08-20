/**
 * `skillet auth logout` — revoke the registry session and clear local credentials.
 */
import { unlink } from 'node:fs/promises';
import { REGISTRY_URL_DEFAULT } from '../kit/types.js';
import { REGISTRY_API } from '../registry-api.js';
import { RegistryError } from '../registry/client.js';
import { loadSessionToken, sessionFilePath } from '../session-token.js';
import { clearDeviceToken, readActiveDeviceFile } from '../device-token.js';

export interface AuthLogoutOptions {
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface AuthLogoutResult {
  /** Registry session revoke succeeded (or no token was present). */
  serverRevoked: boolean;
  /** Human-readable registry error when revoke failed but local session was cleared. */
  serverWarning?: string;
}

export async function authLogout(opts: AuthLogoutOptions = {}): Promise<AuthLogoutResult> {
  const token = await loadSessionToken(opts.token);
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  let serverRevoked = true;
  let serverWarning: string | undefined;

  if (token) {
    try {
      const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/auth/logout`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.status !== 204 && !res.ok) {
        serverRevoked = false;
        serverWarning = `Registry logout failed (HTTP ${res.status})`;
      }
    } catch (err) {
      serverRevoked = false;
      serverWarning =
        err instanceof RegistryError
          ? err.message
          : `Logout failed: ${(err as Error).message}`;
    }
  }

  // Revoke THIS machine's device too (#464): logout must end the machine's
  // access, not just the session. Soft-revoke keeps the row so re-pairing this
  // machine reclaims it. Uses the device token (the session token is already
  // revoked above), and touches only the current device_id, so a desktop vs CLI
  // peer sharing a machine_id stays independent.
  const device = await readActiveDeviceFile();
  if (device?.device_id && device.device_token) {
    try {
      const res = await fetchImpl(
        `${registryUrl}${REGISTRY_API}/devices/${encodeURIComponent(device.device_id)}/revoke`,
        { method: 'POST', headers: { authorization: `Bearer ${device.device_token}` } },
      );
      if (res.status !== 204 && !res.ok) {
        serverRevoked = false;
        serverWarning = serverWarning ?? `Registry device revoke failed (HTTP ${res.status})`;
      }
    } catch (err) {
      serverRevoked = false;
      serverWarning =
        serverWarning ??
        (err instanceof RegistryError
          ? err.message
          : `Device revoke failed: ${(err as Error).message}`);
    }
  }

  try {
    await unlink(sessionFilePath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  // Clear the local device credential so the machine is fully signed out.
  // Re-pairing restores access (the server row is preserved by the soft-revoke).
  await clearDeviceToken();

  return { serverRevoked, ...(serverWarning ? { serverWarning } : {}) };
}
