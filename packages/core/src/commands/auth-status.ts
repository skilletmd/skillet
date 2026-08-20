/**
 * `skillet auth status` — show session, device, and signing identity state.
 */
import {
  isLinkedMachineCredentials,
  loadRegistryBearer,
  type RegistryBearerKind,
} from '../auth-token.js';
import { readActiveDeviceFile } from '../device-token.js';
import { readSessionFileToken } from '../session-token.js';
import { loadIdentity } from '../identity/index.js';
import { REGISTRY_URL_DEFAULT } from '../kit/types.js';
import { REGISTRY_API } from '../registry-api.js';

export interface AuthStatusOptions {
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface AuthStatus {
  bearer: { kind: RegistryBearerKind; tokenPreview: string | null };
  identity: {
    handle: string | null;
    keyId: string | null;
    registryUrl: string;
  } | null;
  whoami: {
    handle: string | null;
    avatar_url: string | null;
    device_id: string | null;
    user_id: string | null;
    author_key_id: string | null;
    scopes: string[];
  } | null;
  /**
   * Pair-claimed machine credentials (session + device) present locally and not
   * known-dead. Stays true when whoami is merely offline (network/5xx) so the
   * tray keeps showing last-known linked state — but flips false the moment the
   * registry explicitly rejects the credential (see `credential_rejected`).
   */
  linked_machine: boolean;
  /**
   * The registry answered but rejected this machine's bearer (401/403) — the
   * credential was revoked from the web, or is a stale/anonymous-era token. This
   * is NOT the same as offline: the machine must re-pair, not just reconnect.
   */
  credential_rejected: boolean;
  /** This machine's device label from device.json (what the web Connections
   * list calls it) — so local surfaces can say WHICH device this is. */
  device_label: string | null;
  hints: string[];
}

function tokenPreview(token: string): string {
  if (token.length < 12) return token;
  return `${token.slice(0, 12)}…`;
}

export async function authStatus(opts: AuthStatusOptions = {}): Promise<AuthStatus> {
  const bearer = await loadRegistryBearer(opts.token);
  const registryUrl =
    opts.registryUrl ??
    process.env['SKILLET_REGISTRY_URL'] ??
    process.env['SKILLET_REGISTRY'] ??
    REGISTRY_URL_DEFAULT;
  const hints: string[] = [];

  let identity: AuthStatus['identity'] = null;
  try {
    const id = await loadIdentity();
    if (id) {
      identity = {
        handle: id.handle,
        keyId: id.keyId,
        registryUrl: id.registryUrl ?? registryUrl,
      };
    }
  } catch {
    // no local signing identity
  }

  let whoami: AuthStatus['whoami'] = null;
  let credentialRejected = false;
  if (bearer.token) {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    try {
      const res = await fetchImpl(`${registryUrl.replace(/\/+$/, '')}${REGISTRY_API}/whoami`, {
        headers: { authorization: `Bearer ${bearer.token}`, accept: 'application/json' },
      });
      if (res.status === 401 || res.status === 403) {
        // Registry reached us and refused the token — revoked, or a stale
        // anonymous-era token. Distinct from offline: caller must re-pair.
        credentialRejected = true;
      }
      if (res.ok) {
        const body = (await res.json()) as {
          handle?: string | null;
          avatar_url?: string | null;
          device_id?: string | null;
          user_id?: string | null;
          author_key_id?: string | null;
          scopes?: string[];
        };
        whoami = {
          handle: body.handle ?? null,
          avatar_url: body.avatar_url ?? null,
          device_id: body.device_id ?? null,
          user_id: body.user_id ?? null,
          author_key_id: body.author_key_id ?? null,
          scopes: Array.isArray(body.scopes) ? body.scopes : [],
        };
      }
    } catch {
      // offline
    }
  }

  const deviceFile = await readActiveDeviceFile();
  const sessionFromFile = await readSessionFileToken();
  const linked_machine =
    isLinkedMachineCredentials(deviceFile, sessionFromFile) && !credentialRejected;
  const device_label = deviceFile?.label ?? null;

  if (credentialRejected) {
    hints.push('This machine was disconnected — its saved credential is no longer valid.');
    hints.push('Re-pair with `skillet connect <code>` (get a code in Settings on the web).');
  } else if (bearer.kind === 'none') {
    hints.push('This machine is not paired — sign in at skillet.md, then open Settings → Devices for a pair code.');
    hints.push('Run `skillet connect <code>` with the pair code to sync kits across machines.');
    hints.push('Nothing syncs until this machine is paired.');
  } else if (bearer.kind === 'device' && !whoami?.user_id) {
    hints.push('Device linked — account kits sync when online.');
    if (!whoami) {
      hints.push('Registry is unreachable; showing last-known linked state.');
    }
  } else if (bearer.kind === 'session') {
    hints.push('Signed in — list, sync, and session publish work on this device.');
    const remotePrimary = whoami?.author_key_id ?? null;
    const localPrimary = identity?.keyId ?? null;
    if (remotePrimary && localPrimary && localPrimary !== remotePrimary) {
      hints.push(
        'Local signing key does not match the registry primary — this device is session-linked, not primary.',
      );
      hints.push(
        'Device approve/revoke and signature-based publish need the primary machine. Session publish does not.',
      );
    } else if (whoami?.handle && remotePrimary && !localPrimary) {
      hints.push(
        'No local primary key on this device — normal for a linked machine. Session publish works while signed in.',
      );
    } else if (whoami?.handle && remotePrimary && localPrimary === remotePrimary) {
      hints.push('This device holds the registry primary signing key.');
    } else if (!identity?.handle) {
      hints.push(
        'A local signing key is only needed for primary-key workflows (device approve, delegated signing).',
      );
    }
  }

  return {
    bearer: {
      kind: bearer.kind,
      tokenPreview: bearer.token ? tokenPreview(bearer.token) : null,
    },
    identity,
    whoami,
    linked_machine,
    credential_rejected: credentialRejected,
    device_label,
    hints,
  };
}
