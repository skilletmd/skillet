/**
 * `skillet claim` — bind the local Ed25519 author key to the session user.
 */
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadIdentity, saveIdentity } from '../identity/index.js';
import {
  generateAuthorKey,
  loadAuthorKey,
  saveAuthorKey,
  type AuthorKey,
} from '../signing/index.js';
import { REGISTRY_URL_DEFAULT } from '../kit/types.js';
import { REGISTRY_API } from '../registry-api.js';
import { RegistryError } from '../registry/client.js';
import { loadSessionToken, envSessionToken, readSessionFileToken } from '../session-token.js';

export interface ClaimOptions {
  registryUrl?: string;
  token?: string;
  handle?: string;
  configDir?: string;
  fetchImpl?: typeof fetch;
}

export interface ClaimResult {
  handle: string;
  key_id: string;
  /**
   * True when the handle already has a primary key on another machine. The
   * session remains valid for sync; this machine is not the primary signer.
   */
  primaryElsewhere?: boolean;
}

/** User-facing copy when this machine is linked but not the primary signer. */
export function secondaryDeviceMessage(handle: string): string {
  return (
    `Account @${handle} is linked on this machine for sync. ` +
    `Your primary signing key lives on another device — only one machine holds the primary key. ` +
    `Use \`skillet sync\` here; publish from your primary machine, skillet.md Studio, ` +
    `or run \`skillet device approve\` on the primary to delegate signing to this device.`
  );
}

function defaultConfigDir(): string {
  return process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config');
}

async function loadOrCreateAuthorKey(configDir: string): Promise<AuthorKey> {
  try {
    return await loadAuthorKey(configDir);
  } catch {
    const key = generateAuthorKey();
    await saveAuthorKey(key, configDir);
    return key;
  }
}

async function resolveClaimHandle(
  token: string,
  registryUrl: string,
  identity: Awaited<ReturnType<typeof loadIdentity>>,
  explicitHandle: string | undefined,
  fetchImpl: typeof fetch,
): Promise<string> {
  const fromOpts = explicitHandle?.trim().toLowerCase();
  if (fromOpts) return fromOpts;
  if (identity?.handle) return identity.handle;

  let res: Response;
  try {
    res = await fetchImpl(`${registryUrl}${REGISTRY_API}/whoami`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    });
  } catch (err) {
    throw new RegistryError('network_error', `Request failed: ${(err as Error).message}`);
  }

  const body = (await res.json().catch(() => null)) as { handle?: string | null } | null;
  if (!res.ok) {
    throw new RegistryError(
      'whoami_failed',
      'Could not resolve your registry handle. Run `skillet connect <code>` and retry.',
      res.status,
      body,
    );
  }

  const fromSession = body?.handle?.trim().toLowerCase();
  if (!fromSession) {
    throw new RegistryError(
      'handle_not_claimed',
      'This account has no handle yet. Run `skillet login --handle <you> --name "<Name>"` to register one.',
    );
  }
  return fromSession;
}

function claimErrorMessage(
  code: string,
  message: string,
  payload: unknown,
  staleEnvHint: string,
): string {
  if (code === 'name_taken') {
    return (
      `Handle is already claimed by another account. Pick a different handle ` +
      `(or reset the local registry DB if this is dev dogfood).`
    );
  }
  if (code === 'already_claimed') {
    const existing =
      payload && typeof payload === 'object' && 'handle' in payload
        ? String((payload as Record<string, unknown>).handle)
        : null;
    return existing
      ? `This session is already bound to @${existing}. Use that handle, sign in with a fresh email, or run \`skillet login --handle ${existing}\`.${staleEnvHint}`
      : `${message}${staleEnvHint}`;
  }
  if (code === 'key_change_forbidden') {
    return (
      `This handle already has a primary signing key on another machine. ` +
      `Link this device with \`skillet connect <code>\` for sync — ` +
      `do not run \`skillet claim\` again on secondary machines.`
    );
  }
  return message;
}

export async function claimHandle(opts: ClaimOptions = {}): Promise<ClaimResult> {
  const token = await loadSessionToken(opts.token);
  if (!token) {
    throw new RegistryError(
      'not_authenticated',
      'A session token is required. Run `skillet connect <code>` first.',
    );
  }

  const identity = await loadIdentity();
  const registryUrl = (opts.registryUrl ?? identity?.registryUrl ?? REGISTRY_URL_DEFAULT).replace(
    /\/+$/,
    '',
  );
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const handle = await resolveClaimHandle(token, registryUrl, identity, opts.handle, fetchImpl);

  const configDir = opts.configDir ?? defaultConfigDir();
  const key = await loadOrCreateAuthorKey(configDir);
  const jwk = key.publicKey.export({ format: 'jwk' }) as { x: string };
  const publicKey = Buffer.from(jwk.x, 'base64url').toString('base64');

  const url = `${registryUrl}${REGISTRY_API}/claim`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        handle,
        public_key: publicKey,
        key_id: key.keyId,
      }),
    });
  } catch (err) {
    throw new RegistryError('network_error', `Request failed: ${(err as Error).message}`);
  }

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const code =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as Record<string, unknown>).error)
        : `http_${res.status}`;
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as Record<string, unknown>).message)
        : `Claim failed (HTTP ${res.status})`;
    const fileToken = await readSessionFileToken();
    const staleEnvHint =
      envSessionToken() && fileToken && envSessionToken() !== fileToken
        ? ' A stale SKILLET_TOKEN in your shell may be overriding ~/.skillet/session.json — run `unset SKILLET_TOKEN` and retry.'
        : '';

    if (code === 'key_change_forbidden') {
      let whoamiRes: Response;
      try {
        whoamiRes = await fetchImpl(`${registryUrl}${REGISTRY_API}/whoami`, {
          headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        });
      } catch {
        whoamiRes = new Response(null, { status: 0 });
      }
      const whoamiBody = (await whoamiRes.json().catch(() => null)) as {
        handle?: string | null;
        author_key_id?: string | null;
      } | null;
      const sessionHandle = whoamiBody?.handle?.trim().toLowerCase();
      const remoteKeyId = whoamiBody?.author_key_id?.trim();
      if (
        whoamiRes.ok &&
        sessionHandle === handle &&
        remoteKeyId &&
        remoteKeyId.length > 0
      ) {
        return {
          handle: sessionHandle,
          key_id: remoteKeyId,
          primaryElsewhere: true,
        };
      }
    }

    throw new RegistryError(
      code,
      claimErrorMessage(code, message, payload, staleEnvHint),
      res.status,
      payload,
    );
  }

  const result = payload as ClaimResult;

  if (!identity) {
    await saveIdentity({
      handle: result.handle,
      keyId: key.keyId,
      registryUrl,
      createdAt: new Date().toISOString(),
    });
  }

  return result;
}
