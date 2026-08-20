/**
 * `skillet auth disconnect` — clear local registry credentials on this machine.
 */
import { unlink } from 'node:fs/promises';
import { clearDeviceToken, readDeviceFile, readDeviceId } from '../device-token.js';
import { identityPath } from '../identity/index.js';
import { REGISTRY_URL_DEFAULT } from '../kit/types.js';
import { REGISTRY_API } from '../registry-api.js';
import { loadSessionToken, sessionFilePath } from '../session-token.js';
import { authLogout, type AuthLogoutOptions } from './auth-logout.js';

export type AuthDisconnectOptions = AuthLogoutOptions;

export interface AuthDisconnectResult {
  /** This machine's server-side device row was removed, or there was none to
   *  remove (already gone / never paired). False only when it may still be live
   *  and we couldn't reach the registry to remove it. */
  unregistered: boolean;
  /** Human-readable warning when the machine could not be unregistered. */
  warning?: string;
}

/** DELETE can hang forever on a black-hole network; sign-out must not. */
const DISCONNECT_TIMEOUT_MS = 8000;

const DISCONNECT_WARNING =
  "Couldn't reach the registry to unregister this machine — remove it at your account Settings → Devices.";

/** Revoke the session when possible, then remove session, device, and identity files locally. */
export async function authDisconnectLocal(
  opts: AuthDisconnectOptions = {},
): Promise<AuthDisconnectResult> {
  const unregister = await unregisterDevice(opts);

  // Skip the follow-on session revoke when the device DELETE already succeeded:
  // a 204 cascades the device-bound session's revocation server-side, so calling
  // logout afterwards would 401 on the session it just killed and warn falsely.
  if (!unregister.deleteSucceeded) {
    try {
      await authLogout(opts);
    } catch {
      // Best-effort registry revoke; we still clear local credentials below.
    }
  }

  try {
    await unlink(sessionFilePath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  await clearDeviceToken();

  try {
    await unlink(identityPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  return {
    unregistered: unregister.unregistered,
    ...(unregister.warning ? { warning: unregister.warning } : {}),
  };
}

/** Remove this machine's device row server-side. Prefers the device token (never
 *  expires) over the session (lapses at the TTL), so a long-lived machine can
 *  still unregister itself; falls back to the session for registries that predate
 *  the device self-unregister lane. */
async function unregisterDevice(
  opts: AuthDisconnectOptions,
): Promise<{ unregistered: boolean; deleteSucceeded: boolean; warning?: string }> {
  const device = await readDeviceFile();
  const deviceId = device?.device_id ?? (await readDeviceId());
  // Nothing to remove: never paired, or a legacy file with no device_id. Sign-out
  // is purely local here — no warning.
  if (!deviceId) return { unregistered: true, deleteSucceeded: false };

  // Honor SKILLET_REGISTRY_URL so the dev binary and any registry-scoped shell
  // unregister against the registry that actually holds the device row; without
  // it, sign-out DELETEs prod under a dev-scoped token and strands the dev row.
  const registryUrl = (
    opts.registryUrl ??
    process.env['SKILLET_REGISTRY_URL'] ??
    process.env['SKILLET_REGISTRY'] ??
    REGISTRY_URL_DEFAULT
  ).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const url = `${registryUrl}${REGISTRY_API}/devices/${encodeURIComponent(deviceId)}`;

  const attempt = async (bearer: string): Promise<number | 'error'> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DISCONNECT_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${bearer}` },
        signal: ctrl.signal,
      });
      return res.status;
    } catch {
      return 'error';
    } finally {
      clearTimeout(timer);
    }
  };

  const deviceToken = device?.device_token;
  const sessionToken = await loadSessionToken(opts.token);

  let status: number | 'error';
  if (deviceToken) {
    status = await attempt(deviceToken);
    // 401 → a stale device token, or a registry too old to accept device auth on
    // this route; retry with the session token when we have one.
    if (status === 401 && sessionToken) status = await attempt(sessionToken);
  } else if (sessionToken) {
    status = await attempt(sessionToken);
  } else {
    // No credential to authenticate the DELETE; the row may still be live.
    return { unregistered: false, deleteSucceeded: false, warning: DISCONNECT_WARNING };
  }

  if (status === 204) return { unregistered: true, deleteSucceeded: true };
  // 404 (row already gone) or 401 (token already dead) — nothing left to remove.
  if (status === 404 || status === 401) return { unregistered: true, deleteSucceeded: false };
  // Network error, timeout, 5xx, or 403 — the row may still be live; warn.
  return { unregistered: false, deleteSucceeded: false, warning: DISCONNECT_WARNING };
}
