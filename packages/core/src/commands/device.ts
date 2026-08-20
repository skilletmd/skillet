/**
 * `skillet device …` — manage author-signed device-key delegations.
 *
 *   approve <device_pub|code>  mint + sign a DelegationCert with the PRIMARY key
 *                              and register it (POST /api/v1/delegations).
 *   list                       GET /api/v1/delegations — active/expired/revoked.
 *   revoke <device_key_id>     mint + sign a RevocationStatement (primary key)
 *                              and POST it (.../revoke).
 *
 * "Enroll" is the end-to-end pairing FLOW, not a CLI write: the device/browser
 * generates its own non-extractable key and presents the public half (design
 * §4.1); the CLI's half of enrollment is `approve`. Per security invariant §9.8
 * this command writes NO new private key to disk — the only private key it
 * touches is the primary key already in the keystore, used solely to sign.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { loadIdentity } from "../identity/index.js";
import { loadAuthorKeyById } from "../signing/index.js";
import {
  mintDelegation,
  mintRevocation,
  deviceKeyIdFromPub,
  DelegationError,
} from "../signing/delegation.js";
import { RegistryClient, type DelegationListItem, type BearerDeviceListItem } from "../registry/client.js";
import { loadSessionToken } from "../session-token.js";
import { loadRegistryBearer } from "../auth-token.js";
import { readActiveDeviceFile, saveDeviceToken } from "../device-token.js";
import { REGISTRY_URL_DEFAULT } from "../kit/types.js";
import type { DelegationScope } from "@skillet/protocol";
import { collapseDevicesByMachine } from "@skillet/protocol/device-collapse";

function defaultConfigDir(): string {
  return process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
}

/**
 * Registry base URL for device commands. Mirrors auth-status/account-client
 * precedence: explicit override → SKILLET_REGISTRY_URL / SKILLET_REGISTRY env
 * → pinned identity → prod default. The env branch is load-bearing for the dev
 * binary and any SKILLET_REGISTRY_URL-scoped shell: without it, `skillet
 * device …` resolved to prod under a dev-scoped device token and 401'd as
 * "anonymous devices are no longer supported".
 */
function resolveDeviceRegistryUrl(
  opts: { registryUrl?: string },
  identity: { registryUrl?: string } | null,
): string {
  return (
    opts.registryUrl ??
    process.env["SKILLET_REGISTRY_URL"] ??
    process.env["SKILLET_REGISTRY"] ??
    identity?.registryUrl ??
    REGISTRY_URL_DEFAULT
  ).replace(/\/+$/, "");
}

export class DeviceCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeviceCommandError";
  }
}

interface BaseDeviceOptions {
  configDir?: string;
  registryUrl?: string;
  /** Explicit session token; falls back to the env / session file. */
  token?: string;
  fetchImpl?: typeof fetch;
}

/** Load a registry session bearer, or throw a user-actionable error. */
async function requireSessionToken(
  opts: BaseDeviceOptions,
): Promise<{ token: string; registryUrl: string }> {
  const token = await loadSessionToken(opts.token);
  if (!token) {
    throw new DeviceCommandError(
      "A session token is required. Run `skillet connect <code>` first.",
    );
  }
  const identity = await loadIdentity();
  const registryUrl = resolveDeviceRegistryUrl(opts, identity);
  return { token, registryUrl };
}

/** Primary-key flows need a local signing identity on this machine. */
async function requirePrimarySigner(
  opts: BaseDeviceOptions,
): Promise<{
  identity: NonNullable<Awaited<ReturnType<typeof loadIdentity>>>;
  token: string;
}> {
  const identity = await loadIdentity();
  if (!identity?.keyId) {
    throw new DeviceCommandError(
      "Primary signing key required on this machine. " +
        "Use `skillet device approve` from the device that holds your primary key, " +
        "or publish from skillet.md Studio.",
    );
  }
  const { token } = await requireSessionToken(opts);
  return { identity, token };
}

function clientFor(
  opts: BaseDeviceOptions,
  identity: { registryUrl?: string },
  token: string,
): RegistryClient {
  return new RegistryClient({
    baseUrl: resolveDeviceRegistryUrl(opts, identity),
    token,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
}

/**
 * Accepts either a raw base64 device pubkey or a pairing payload — a JSON
 * `{ "device_pub": "<base64>", "label"?: "<str>" }` string the browser may show
 * as a QR/code (design §4.1 step 2). Returns the normalized pub + optional label.
 */
export function parseDevicePairing(input: string): { devicePubB64: string; label?: string } {
  const trimmed = input.trim();
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new DeviceCommandError("pairing code is not valid JSON");
    }
    const o = parsed as Record<string, unknown>;
    if (typeof o.device_pub !== "string" || o.device_pub.length === 0) {
      throw new DeviceCommandError("pairing code is missing a device_pub field");
    }
    return {
      devicePubB64: o.device_pub,
      ...(typeof o.label === "string" && o.label.length > 0 ? { label: o.label } : {}),
    };
  }
  return { devicePubB64: trimmed };
}

export interface ApproveDeviceOptions extends BaseDeviceOptions {
  /** Browser-presented device pubkey (base64) or a JSON pairing code. */
  pairing: string;
  /** Subset of {propose,approve,publish}. Defaults to all three. */
  scopes?: DelegationScope[];
  /** Lifetime in days. Defaults to 90; capped server- and client-side at 365. */
  ttlDays?: number;
  /** Override the label parsed from a pairing code. */
  label?: string;
  /** Injectable clock (unix seconds) for deterministic tests. */
  now?: number;
}

export interface ApproveDeviceResult {
  deviceKeyId: string;
  expiresAt: number;
  scopes: string[];
  /** True when the registry returned 200 (idempotent re-POST of the same cert). */
  alreadyRegistered: boolean;
}

/**
 * `skillet device approve` — mint a DelegationCert for the presented device
 * pubkey, sign it with the primary key, and register it. The primary private
 * key is loaded only to sign and never leaves this process.
 */
export async function approveDevice(opts: ApproveDeviceOptions): Promise<ApproveDeviceResult> {
  const { identity, token } = await requirePrimarySigner(opts);
  const { devicePubB64, label: codeLabel } = parseDevicePairing(opts.pairing);
  // Validate early so we fail before loading the private key on a bad pub.
  deviceKeyIdFromPub(devicePubB64);

  const configDir = opts.configDir ?? defaultConfigDir();
  const primaryKey = await loadAuthorKeyById(configDir, identity.keyId);

  const { signed, label } = mintDelegation({
    primaryKey,
    handle: identity.handle,
    devicePubB64,
    ...(opts.scopes ? { scopes: opts.scopes } : {}),
    ...(opts.ttlDays != null ? { ttlSec: Math.round(opts.ttlDays * 86400) } : {}),
    ...(opts.label ?? codeLabel ? { label: opts.label ?? codeLabel } : {}),
    ...(opts.now != null ? { now: opts.now } : {}),
  });

  const client = clientFor(opts, identity, token);
  const res = await client.registerDelegation({
    cert: signed.cert,
    cert_sig: signed.cert_sig,
    ...(label ? { label } : {}),
  });
  return {
    deviceKeyId: res.device_key_id,
    expiresAt: res.expires_at,
    scopes: res.scopes,
    alreadyRegistered: res.already_exists,
  };
}

/** Rows from GET /api/v1/delegations and GET /api/v1/devices (matches web Connected devices). */
export interface ConnectedDevicesResult {
  delegations: DelegationListItem[];
  sync_devices: BearerDeviceListItem[];
}

/**
 * `skillet device` / `device list` — the machines on your account. Bearer is
 * device-token-first (session fallback) via loadRegistryBearer, so the view
 * keeps working after a web session lapses — the device token is the durable
 * machine credential, same policy as rename/whoami. The registry's GET
 * /devices accepts an account-bound device token (requireUser).
 */
export async function listDevices(opts: BaseDeviceOptions): Promise<ConnectedDevicesResult> {
  const bearer = await loadRegistryBearer(opts.token);
  if (!bearer.token) {
    throw new DeviceCommandError(
      "This machine isn't connected. Run `skillet connect <code>` first.",
    );
  }
  const identity = await loadIdentity();
  const registryUrl = resolveDeviceRegistryUrl(opts, identity);
  const client = new RegistryClient({
    baseUrl: registryUrl,
    token: bearer.token,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  // Collapse the raw rows so one physical machine shows once: desktop + CLI on
  // the same machine are separately-credentialed rows that share a machine_id
  // and don't always converge server-side (a warm sibling can't be safely
  // token-rotated on re-pair). Keep THIS machine's device_id as the survivor so
  // rename/delete still target the right row.
  const rows = await client.listBearerDevices();
  const active = await readActiveDeviceFile().catch(() => null);
  const sync_devices = collapseDevicesByMachine(rows, active?.device_id ?? null);
  return { delegations: [], sync_devices };
}

export interface RenameDeviceResult {
  device_id: string;
  label: string | null;
}

/**
 * `skillet device rename <label>` — rename THIS machine's device row.
 *
 * Bearer follows loadRegistryBearer's existing priority (device token first,
 * session fallback): post plan 2026-07-08-002 the registry accepts a device's
 * own token for self-rename, and the device token is the durable credential
 * while sessions lapse. Empty/whitespace labels are rejected BEFORE any
 * network call — the server would null the label and local surfaces gate on
 * one existing. On success the local device.json label is rewritten too
 * (machine_id preserved by saveDeviceToken), so `auth status` and the tray
 * show the new name immediately.
 */
export async function renameDevice(
  label: string,
  opts: BaseDeviceOptions = {},
): Promise<RenameDeviceResult> {
  const trimmed = label.trim();
  if (trimmed.length === 0) {
    throw new DeviceCommandError("Label cannot be empty.");
  }

  const deviceFile = await readActiveDeviceFile();
  if (!deviceFile?.device_id || !deviceFile.device_token) {
    throw new DeviceCommandError(
      "This machine is not paired. Run `skillet connect <code>` first.",
    );
  }

  const bearer = await loadRegistryBearer(opts.token);
  if (bearer.kind === "none") {
    throw new DeviceCommandError(
      "No registry credential found. Run `skillet connect <code>` first.",
    );
  }

  const identity = await loadIdentity().catch(() => null);
  const registryUrl = resolveDeviceRegistryUrl(opts, identity);

  const client = new RegistryClient({
    baseUrl: registryUrl,
    token: bearer.token,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });
  const result = await client.renameDevice(deviceFile.device_id, trimmed);

  // Keep the local name in lockstep with the registry (R3). saveDeviceToken
  // carries machine_id forward on its own; label comes from the server's
  // cleaned value so clamping never diverges.
  if (result.label) {
    await saveDeviceToken(deviceFile.device_token, {
      device_id: deviceFile.device_id,
      label: result.label,
      ...(deviceFile.machine_id ? { machine_id: deviceFile.machine_id } : {}),
    });
  }

  return result;
}

export interface RevokeDeviceOptions extends BaseDeviceOptions {
  deviceKeyId: string;
  now?: number;
}

export interface RevokeDeviceResult {
  deviceKeyId: string;
  revokedAt: number;
}

/**
 * `skillet device revoke` — mint + sign a RevocationStatement with the primary
 * key and submit it. After this, the registry rejects new propose/approve from
 * the key, and clients that pull the revocation refuse fresh acceptance.
 */
export async function revokeDevice(opts: RevokeDeviceOptions): Promise<RevokeDeviceResult> {
  const { identity, token } = await requirePrimarySigner(opts);
  const configDir = opts.configDir ?? defaultConfigDir();
  const primaryKey = await loadAuthorKeyById(configDir, identity.keyId);

  const signed = mintRevocation({
    primaryKey,
    deviceKeyId: opts.deviceKeyId,
    ...(opts.now != null ? { now: opts.now } : {}),
  });

  const client = clientFor(opts, identity, token);
  const res = await client.revokeDelegation(opts.deviceKeyId, {
    revocation: signed.revocation,
    revocation_sig: signed.revocation_sig,
  });
  return { deviceKeyId: res.device_key_id, revokedAt: res.revoked_at };
}

export { DelegationError };
