/**
 * `skillet pair` — mint a join code from an already-joined machine.
 *
 * The symmetric counterpart to `skillet connect <code>`: any surface that holds
 * an account-bound token (session or user device token) can mint a short code,
 * which another surface — web, CLI, or desktop — redeems to join the same
 * account. This is what makes attach work in any order.
 */
import { loadRegistryBearer } from '../auth-token.js';
import { REGISTRY_URL_DEFAULT } from '../kit/types.js';
import { REGISTRY_API } from '../registry-api.js';

export interface MintPairCodeOptions {
  registryUrl?: string;
  /** Explicit bearer; defaults to the best local token (session → device). */
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface MintPairCodeResult {
  code: string;
  expires_at: number;
  ttl_sec: number;
}

export async function mintPairCode(
  opts: MintPairCodeOptions = {},
): Promise<MintPairCodeResult> {
  const bearer = await loadRegistryBearer(opts.token);
  if (!bearer.token || (bearer.kind !== 'session' && bearer.kind !== 'device')) {
    throw new Error(
      'Not signed in on this machine. Run `skillet login` or join with `skillet connect <code>` first.',
    );
  }

  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const res = await fetchImpl(`${registryUrl}${REGISTRY_API}/connect/codes`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer.token}`, accept: 'application/json' },
  });

  const body = (await res.json().catch(() => null)) as
    | (MintPairCodeResult & { message?: string; error?: string })
    | null;

  if (!res.ok || !body?.code) {
    const msg =
      body && typeof body === 'object' && 'message' in body && body.message
        ? String(body.message)
        : body?.error
          ? String(body.error)
          : `HTTP ${res.status}`;
    throw new Error(`Could not mint a pair code: ${msg}`);
  }

  return { code: body.code, expires_at: body.expires_at, ttl_sec: body.ttl_sec };
}
