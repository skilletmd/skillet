// Skillet team create|invite|members
// Thin wrappers over the /api/v1/orgs registry endpoints.
import { REGISTRY_URL_DEFAULT } from '../kit/types.js';
import { RegistryError } from '../registry/client.js';
import { loadSessionToken } from '../session-token.js';
import { REGISTRY_API as API } from '../registry-api.js';

async function sessionToken(explicit?: string): Promise<string> {
  return loadSessionToken(explicit);
}

export interface TeamCreateOptions {
  slug: string;
  name: string;
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface TeamCreateResult {
  org_id: string;
  slug: string;
  name: string;
}

export interface TeamInviteOptions {
  orgSlug: string;
  handle?: string;
  email?: string;
  role?: 'admin' | 'member';
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface TeamInviteResult {
  status: 'added' | 'invited';
  invite_id?: string;
  member_id?: string;
}

export interface OrgMember {
  user_id: string;
  handle: string | null;
  role: string;
  invited_at: number;
  accepted_at: number | null;
}

export interface PendingInvite {
  invite_id: string;
  handle: string | null;
  email: string | null;
  role: string;
  invited_at: number;
}

export interface TeamMembersResult {
  org: { id: string; slug: string; name: string };
  members: OrgMember[];
  pending: PendingInvite[];
}

export interface TeamMembersOptions {
  orgSlug: string;
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

async function post(
  url: string,
  body: unknown,
  token: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
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
        : `Request failed (HTTP ${res.status})`;
    throw new RegistryError(code, message, res.status, payload);
  }
  return payload;
}

async function get(
  url: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${token}`,
      },
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
        : `Request failed (HTTP ${res.status})`;
    throw new RegistryError(code, message, res.status, payload);
  }
  return payload;
}

export async function createOrg(opts: TeamCreateOptions): Promise<TeamCreateResult> {
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const token = await sessionToken(opts.token);
  if (!token) {
    throw new RegistryError(
      'not_authenticated',
      'A session token is required. Run `skillet connect <code>` or set SKILLET_TOKEN.',
    );
  }
  const url = `${registryUrl}${API}/orgs`;
  return post(url, { slug: opts.slug, name: opts.name }, token, fetchImpl) as Promise<TeamCreateResult>;
}

export async function inviteOrgMember(opts: TeamInviteOptions): Promise<TeamInviteResult> {
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const token = await sessionToken(opts.token);
  if (!token) {
    throw new RegistryError(
      'not_authenticated',
      'A session token is required. Run `skillet connect <code>` or set SKILLET_TOKEN.',
    );
  }
  const url = `${registryUrl}${API}/orgs/${encodeURIComponent(opts.orgSlug)}/invites`;
  return post(
    url,
    {
      handle: opts.handle,
      email: opts.email,
      role: opts.role ?? 'member',
    },
    token,
    fetchImpl,
  ) as Promise<TeamInviteResult>;
}

export async function listOrgMembers(opts: TeamMembersOptions): Promise<TeamMembersResult> {
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const token = await sessionToken(opts.token);
  if (!token) {
    throw new RegistryError(
      'not_authenticated',
      'A session token is required. Run `skillet connect <code>` or set SKILLET_TOKEN.',
    );
  }
  const url = `${registryUrl}${API}/orgs/${encodeURIComponent(opts.orgSlug)}/members`;
  return get(url, token, fetchImpl) as Promise<TeamMembersResult>;
}
