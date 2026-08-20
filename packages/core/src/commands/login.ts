/**
 * `skillet login` — claim a handle on the registry and bind it to this device's
 * Ed25519 author key.
 *
 * When a registry session exists (`skillet connect`), we bind the handle via
 * `/api/v1/claim` so publish sees the same handle on the session. Without a
 * session, we fall back to the legacy unauthenticated profile registration.
 */
import { join } from "node:path";
import { homedir } from "node:os";
import {
  generateAuthorKey,
  saveAuthorKey,
  loadAuthorKey,
  type AuthorKey,
} from "../signing/index.js";
import {
  saveIdentity,
  loadIdentity,
  type Identity,
} from "../identity/index.js";
import { REGISTRY_URL_DEFAULT } from "../kit/types.js";
import { RegistryClient, RegistryError } from "../registry/client.js";
import { recordEvent, detectInitiator } from "../metrics.js";
import { loadSessionToken } from "../session-token.js";
import { claimHandle } from "./claim.js";

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$|^[a-z0-9]$/;

export interface LoginOptions {
  handle: string;
  name: string;
  avatarUrl?: string;
  registryUrl?: string;
  configDir?: string;
  fetchImpl?: typeof fetch;
}

export interface LoginResult {
  identity: Identity;
  /** true when the registry created a new profile; false on re-login. */
  created: boolean;
}

function defaultConfigDir(): string {
  return process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config");
}

async function loadOrCreateKey(configDir: string): Promise<{ key: AuthorKey; created: boolean }> {
  try {
    const key = await loadAuthorKey(configDir);
    return { key, created: false };
  } catch {
    const key = generateAuthorKey();
    await saveAuthorKey(key, configDir);
    return { key, created: true };
  }
}

async function updateProfileName(
  registryUrl: string,
  handle: string,
  name: string,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  try {
    await fetchFn(`${registryUrl}/profiles/${encodeURIComponent(handle)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ name }),
    });
  } catch {
    // Display name is best-effort; claim already created the author row.
  }
}

export async function login(opts: LoginOptions): Promise<LoginResult> {
  const handle = opts.handle.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    throw new Error(
      `Invalid handle "${opts.handle}": must be 1-40 lowercase alphanumeric characters or hyphens.`
    );
  }

  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/$/, "");
  const configDir = opts.configDir ?? defaultConfigDir();
  const sessionToken = await loadSessionToken();

  const { key } = await loadOrCreateKey(configDir);

  if (sessionToken) {
    const claimResult = await claimHandle({
      handle,
      registryUrl,
      token: sessionToken,
      configDir,
      fetchImpl: opts.fetchImpl,
    });
    if (claimResult.primaryElsewhere) {
      throw new Error(
        `Handle @${handle} already has a primary signing key on another machine. ` +
          `Link this device with \`skillet connect <code>\` for sync.`,
      );
    }
    await updateProfileName(registryUrl, handle, opts.name, opts.fetchImpl);

    const identity: Identity = {
      handle,
      keyId: key.keyId,
      registryUrl,
      createdAt: new Date().toISOString(),
    };
    await saveIdentity(identity);
    recordEvent("login", detectInitiator(), { handle, created: true });
    return { identity, created: true };
  }

  const client = new RegistryClient({
    baseUrl: registryUrl,
    ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
  });

  let created = false;
  try {
    await client.createProfile({
      id: handle,
      name: opts.name,
      ...(opts.avatarUrl ? { avatar_url: opts.avatarUrl } : {}),
    });
    created = true;
  } catch (err) {
    if (err instanceof RegistryError && err.status === 409) {
      const existing = await loadIdentity();
      if (
        !existing ||
        existing.handle !== handle ||
        existing.registryUrl.replace(/\/$/, "") !== registryUrl
      ) {
        throw new Error(
          `Handle "${handle}" is already registered on ${registryUrl}. ` +
            `Pick a different handle, or run \`skillet connect <code>\` first ` +
            `and retry so the handle binds to your session.`
        );
      }
    } else {
      throw err;
    }
  }

  const identity: Identity = {
    handle,
    keyId: key.keyId,
    registryUrl,
    createdAt: new Date().toISOString(),
  };
  await saveIdentity(identity);

  recordEvent("login", detectInitiator(), { handle, created });

  return { identity, created };
}
