/**
 * User-bound registry device bearer (~/.skillet/device.json).
 *
 * Created via POST /api/v1/connect/claim when a machine is pair-claimed.
 * A stored device token takes precedence over session for sync — see
 * auth-token.ts.
 */
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { skilletDir } from './session-token.js';

export interface DeviceTokenFile {
  device_token: string;
  device_id?: string;
  label?: string;
  /**
   * Stable client-minted machine identity, presented at pair-claim so the
   * registry can reclaim this machine's existing device row after the token
   * is lost or clobbered (e.g. a dev-registry pairing overwrote this file).
   * Minted once and carried across every save — losing it only costs dedupe,
   * never access.
   */
  machine_id?: string;
  saved_at: string;
}

export function deviceFilePath(): string {
  return join(skilletDir(), 'device.json');
}

export async function readDeviceFile(): Promise<DeviceTokenFile | null> {
  try {
    const raw = await readFile(deviceFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as DeviceTokenFile;
    if (typeof parsed.device_token !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * The file as written, credential or not. Sign-out leaves a machine_id-only
 * stub (no device_token), which the validating reader above reports as "no
 * device file" — machine-id carry-forward must NOT go through that reader or
 * the identity dies on the first save after sign-out.
 */
async function readRawDeviceFile(): Promise<Partial<DeviceTokenFile> | null> {
  try {
    const raw = await readFile(deviceFilePath(), 'utf8');
    return JSON.parse(raw) as Partial<DeviceTokenFile>;
  } catch {
    return null;
  }
}

/**
 * Device file for credential use, cleaning up a retired anonymous file on sight.
 *
 * A `label: 'anonymous'` device.json is a leftover from the retired
 * anonymous-bootstrap path — migration 049 already deleted its registry row, so
 * it is not a credential and its device_id is dead. Detect it, delete it, and
 * report "no device file". Concentrating the special case here means read sites
 * don't each need a `label !== 'anonymous'` guard (and don't silently misreport
 * link status or send a dead device id when they forget it).
 */
export async function readActiveDeviceFile(): Promise<DeviceTokenFile | null> {
  const file = await readDeviceFile();
  if (file?.label === 'anonymous') {
    await clearDeviceToken();
    return null;
  }
  return file;
}

/** Stored machine identity, credential or not — survives the sign-out stub. */
export async function readStoredMachineId(): Promise<string | undefined> {
  const raw = (await readRawDeviceFile())?.machine_id;
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

/** Machine id from device.json when present — readable even without a valid device token. */
export async function readDeviceId(): Promise<string | undefined> {
  try {
    const raw = await readFile(deviceFilePath(), 'utf8');
    const parsed = JSON.parse(raw) as { device_id?: string };
    return typeof parsed.device_id === 'string' ? parsed.device_id : undefined;
  } catch {
    return undefined;
  }
}

export async function saveDeviceToken(
  deviceToken: string,
  meta: { device_id?: string; label?: string; machine_id?: string } = {},
): Promise<void> {
  await mkdir(skilletDir(), { recursive: true, mode: 0o700 });
  // machine_id must survive saves that don't pass it (auth-connect, any
  // future writer) — dropping it silently re-enables duplicate device rows.
  // Read raw, not via readDeviceFile: the sign-out stub has no token and the
  // validating reader would drop the id on the first save after sign-out.
  const machineId = meta.machine_id ?? (await readStoredMachineId());
  const body: DeviceTokenFile = {
    device_token: deviceToken,
    saved_at: new Date().toISOString(),
    ...(meta.device_id ? { device_id: meta.device_id } : {}),
    ...(meta.label ? { label: meta.label } : {}),
    ...(machineId ? { machine_id: machineId } : {}),
  };
  await writeFile(deviceFilePath(), JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });
}

export async function clearDeviceToken(): Promise<void> {
  // Sign-out kills the credential but keeps the machine identity: a stub with
  // only machine_id stays behind so the next pair reclaims this machine's
  // existing device row instead of minting a duplicate. Every credential
  // reader (readDeviceFile here, the desktop's serde parse) already treats a
  // token-less file as signed-out. Machines with a derivable OS id would
  // survive a plain unlink too — the stub is for the fallback population
  // whose machine_id is a persisted random UUID.
  const rawMachineId = (await readRawDeviceFile())?.machine_id;
  if (typeof rawMachineId === 'string' && rawMachineId.length > 0) {
    const stub = { machine_id: rawMachineId, saved_at: new Date().toISOString() };
    await writeFile(deviceFilePath(), JSON.stringify(stub, null, 2) + '\n', { mode: 0o600 });
    return;
  }
  // Use the static top-level unlink, NOT a dynamic import(): bundled sidecars
  // (the desktop's packaged CLI) can't resolve a runtime import of a node
  // builtin, so the old `await import('node:fs/promises')` threw and the bare
  // catch swallowed it — device.json survived and "Sign out" never stuck.
  try {
    await unlink(deviceFilePath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
