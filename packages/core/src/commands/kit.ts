// Private kit CLI over registry kit + kit-members APIs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { REGISTRY_URL_DEFAULT } from '../kit/types.js';
import { loadIdentity } from '../identity/index.js';
import { RegistryError } from '../registry/client.js';
import { loadSessionToken } from '../session-token.js';
import { REGISTRY_API as API } from '../registry-api.js';

function skilletDir(): string {
  return process.env['SKILLET_DIR'] ?? join(homedir(), '.skillet');
}

function kitAliasesPath(): string {
  return join(skilletDir(), 'kit-aliases.json');
}

async function resolveSessionToken(explicit?: string): Promise<string> {
  return loadSessionToken(explicit);
}

async function readAliases(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(kitAliasesPath(), 'utf8');
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeAlias(owner: string, name: string, kitId: string): Promise<void> {
  const aliases = await readAliases();
  aliases[`${owner}/${name}`] = kitId;
  await mkdir(skilletDir(), { recursive: true });
  await writeFile(kitAliasesPath(), JSON.stringify(aliases, null, 2), 'utf8');
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveKitId(
  kitRef: string,
  owner: string,
): Promise<string> {
  if (UUID_RE.test(kitRef)) return kitRef;
  const aliases = await readAliases();
  const id = aliases[`${owner}/${kitRef}`];
  if (!id) {
    throw new RegistryError(
      'kit_not_found',
      `Kit "${kitRef}" not found for @${owner}. Run \`skillet kit create ${kitRef}\` first.`,
    );
  }
  return id;
}

async function request(
  method: string,
  url: string,
  token: string,
  fetchImpl: typeof fetch,
  body?: unknown,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
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
    let message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as Record<string, unknown>).message)
        : `Request failed (HTTP ${res.status})`;
    if (code === 'not_owner') {
      message =
        'Only the kit owner can do this. Sign in with the owner account (`skillet connect`) ' +
        'and run `skillet kit create` under that handle. On one machine, isolate accounts with SKILLET_DIR.';
    }
    throw new RegistryError(code, message, res.status, payload);
  }
  return payload;
}

async function fetchSessionHandle(
  registryUrl: string,
  token: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  const url = `${registryUrl.replace(/\/+$/, '')}${API}/whoami`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as {
    token_class?: string;
    handle?: string | null;
  } | null;
  if (body?.token_class === 'session' && body.handle) {
    return body.handle;
  }
  return null;
}

async function ownerHandle(opts: {
  token?: string;
  registryUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const token = await resolveSessionToken(opts.token);
  if (!token) {
    throw new RegistryError(
      'not_authenticated',
      'A session token is required. Run `skillet connect <code>` or set SKILLET_TOKEN.',
    );
  }
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const sessionHandle = await fetchSessionHandle(registryUrl, token, fetchImpl);
  const identity = await loadIdentity();
  if (sessionHandle) {
    if (identity?.handle && identity.handle !== sessionHandle) {
      throw new RegistryError(
        'handle_mismatch',
        `Local identity is @${identity.handle} but the signed-in session is @${sessionHandle}. ` +
          'Kit commands use the signed-in account. Sign out and back in, or use SKILLET_DIR to isolate a second account.',
      );
    }
    return sessionHandle;
  }
  if (identity?.handle) {
    throw new RegistryError(
      'handle_not_claimed',
      `Session has no claimed handle. Choose a username at skillet.md or run \`skillet login --handle <you> --name "<Name>"\`.`,
    );
  }
  throw new RegistryError(
    'handle_not_claimed',
    'Claim a handle with `skillet login` before managing kits.',
  );
}

export interface KitCreateOptions {
  name: string;
  description?: string;
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface KitCreateResult {
  id: string;
  owner: string;
  name: string;
}

export async function createKit(opts: KitCreateOptions): Promise<KitCreateResult> {
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const owner = await ownerHandle(opts);
  const url = `${registryUrl}${API}/kits`;
  const token = await resolveSessionToken(opts.token);
  const payload = (await request(
    'POST',
    url,
    token,
    fetchImpl,
    { owner, name: opts.name, description: opts.description ?? null },
  )) as { id: string; owner: string; name: string };
  await writeAlias(owner, opts.name, payload.id);
  return { id: payload.id, owner: payload.owner, name: payload.name };
}

export interface KitAddSkillOptions {
  kitRef: string;
  skillRef: string;
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export async function addSkillToKit(opts: KitAddSkillOptions): Promise<void> {
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const owner = await ownerHandle(opts);
  const kitId = await resolveKitId(opts.kitRef, owner);
  const match = opts.skillRef.match(/^@([^/]+)\/([^/]+)$/);
  if (!match) {
    throw new RegistryError('invalid_ref', 'Skill ref must be @author/slug');
  }
  const url = `${registryUrl}${API}/kits/${encodeURIComponent(kitId)}/skills`;
  const token = await resolveSessionToken(opts.token);
  await request('POST', url, token, fetchImpl, {
    author: match[1],
    slug: match[2],
  });
}

export interface KitInviteOptions {
  kitRef: string;
  handle?: string;
  email?: string;
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface KitInviteResult {
  status: 'added' | 'invited';
  member_id: string;
}

export async function inviteKitMember(opts: KitInviteOptions): Promise<KitInviteResult> {
  if (!opts.handle && !opts.email) {
    throw new RegistryError('missing_identifier', 'Provide handle or email');
  }
  if (opts.handle && opts.email) {
    throw new RegistryError('missing_identifier', 'Provide handle or email, not both');
  }
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const owner = await ownerHandle(opts);
  const kitId = await resolveKitId(opts.kitRef, owner);
  const url = `${registryUrl}${API}/kits/${encodeURIComponent(kitId)}/members`;
  const token = await resolveSessionToken(opts.token);
  return request('POST', url, token, fetchImpl, {
    kind: 'human',
    handle: opts.handle,
    email: opts.email,
  }) as Promise<KitInviteResult>;
}

export interface KitMembersOptions {
  kitRef: string;
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface KitMembersResult {
  /** Kit owner handle (`kits.owner_id`). Present on registry builds with owner in GET /members. */
  owner?: string;
  humans: Array<{ user_id: string; handle: string | null; invited_at: number; accepted_at: number | null }>;
  pending_humans: Array<{ invite_id: string; handle: string | null; email: string | null; invited_at: number }>;
  agents: Array<{ kit_key_id: string; label: string; created_at: number; revoked_at: number | null }>;
}

export async function listKitMembers(opts: KitMembersOptions): Promise<KitMembersResult> {
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const owner = await ownerHandle(opts);
  const kitId = await resolveKitId(opts.kitRef, owner);
  const url = `${registryUrl}${API}/kits/${encodeURIComponent(kitId)}/members`;
  const token = await resolveSessionToken(opts.token);
  return request('GET', url, token, fetchImpl) as Promise<KitMembersResult>;
}

export interface KitKeyMintOptions {
  kitRef: string;
  label: string;
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export interface KitKeyMintResult {
  kit_key_id: string;
  kit_token: string;
  label: string;
}

export async function mintKitKey(opts: KitKeyMintOptions): Promise<KitKeyMintResult> {
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const owner = await ownerHandle(opts);
  const kitId = await resolveKitId(opts.kitRef, owner);
  const url = `${registryUrl}${API}/kits/${encodeURIComponent(kitId)}/members`;
  const token = await resolveSessionToken(opts.token);
  return request('POST', url, token, fetchImpl, {
    kind: 'agent',
    label: opts.label,
  }) as Promise<KitKeyMintResult>;
}

export interface KitMemberRemoveOptions {
  kitRef: string;
  handle: string;
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export async function removeKitMember(opts: KitMemberRemoveOptions): Promise<void> {
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const owner = await ownerHandle(opts);
  const kitId = await resolveKitId(opts.kitRef, owner);
  const members = await listKitMembers(opts);
  const human = members.humans.find((h) => h.handle === opts.handle);
  if (!human) {
    throw new RegistryError('member_not_found', `No member with handle @${opts.handle}`);
  }
  const url = `${registryUrl}${API}/kits/${encodeURIComponent(kitId)}/members`;
  const token = await resolveSessionToken(opts.token);
  await request('DELETE', url, token, fetchImpl, {
    member_id: human.user_id,
  });
}

export interface KitKeyRevokeOptions {
  kitRef: string;
  kitKeyId: string;
  registryUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
}

export async function revokeKitKey(opts: KitKeyRevokeOptions): Promise<void> {
  const registryUrl = (opts.registryUrl ?? REGISTRY_URL_DEFAULT).replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const owner = await ownerHandle(opts);
  const kitId = await resolveKitId(opts.kitRef, owner);
  const url = `${registryUrl}${API}/kits/${encodeURIComponent(kitId)}/members`;
  const token = await resolveSessionToken(opts.token);
  await request('DELETE', url, token, fetchImpl, {
    member_id: opts.kitKeyId,
  });
}
