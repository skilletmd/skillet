/**
 * Repo-token encryption + GitHub ownership verification for connect-your-repo.
 *
 * The repo-scoped OAuth token is a credential that reads the user's repos, so it
 * is encrypted at rest (AES-256-GCM) with a key derived from SKILLET_REPO_TOKEN_KEY.
 * Ownership is proven by the token's own `permissions` on the repo (push/admin) —
 * a public repo alone is not proof, or anyone could "claim" any repo.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

const GH_API = 'https://api.github.com';

function encryptionKey(): Buffer {
  const secret = process.env.SKILLET_REPO_TOKEN_KEY ?? '';
  if (!secret) {
    // Fail CLOSED on a missing key. The deterministic dev fallback is reachable
    // ONLY under the explicit dev-auth gate (SKILLET_ENABLE_DEV_AUTH=1) — never
    // on NODE_ENV alone. A staging / dogfood / misconfigured-prod deployment
    // that forgets the key now refuses to store tokens instead of silently
    // encrypting them under a source-readable key.
    // This mirrors the strict gate in auth/web-internal-sig.ts.
    if (process.env.SKILLET_ENABLE_DEV_AUTH === '1') {
      // Dev convenience only — deterministic so restarts can still decrypt.
      // Never set SKILLET_ENABLE_DEV_AUTH in an environment holding real tokens.
      return scryptSync('skillet-dev-repo-token-key', 'skillet-repo-salt', 32);
    }
    throw new Error(
      'SKILLET_REPO_TOKEN_KEY is required to store connected-repo tokens',
    );
  }
  return scryptSync(secret, 'skillet-repo-salt', 32);
}

/**
 * Whether a real repo-token encryption key is configured. Boot-time posture
 * check only: `encryptionKey` still fails closed at the point of use. Prod ran
 * without the key and nothing said so until a user clicked Connect GitHub, at
 * which point the token write threw AFTER the identity was already linked.
 */
export function repoTokenKeyConfigured(): boolean {
  return (process.env.SKILLET_REPO_TOKEN_KEY ?? '').trim().length > 0;
}

/** AES-256-GCM → base64(iv | authTag | ciphertext). */
export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptToken(enc: string): string {
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

export interface OwnedRepo {
  full: string;
  owner: string;
  name: string;
  private: boolean;
  pushedAt: string | null;
}

interface GhRepo {
  full_name?: string;
  name?: string;
  owner?: { login?: string };
  private?: boolean;
  archived?: boolean;
  pushed_at?: string | null;
  permissions?: { push?: boolean; admin?: boolean };
}

/**
 * The public repos a token can publish from (push/admin), for the connect picker.
 * A read-only (no-scope / identity) token returns the user's public repos across
 * their account and orgs, each with its `permissions` — enough to filter to repos
 * they can push to. Private repos need the full `repo` scope (we don't ask), so
 * they never appear. Returns [] on any failure rather than throwing.
 */
export async function listOwnedRepos(
  token: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<OwnedRepo[]> {
  try {
    const res = await fetchImpl(
      `${GH_API}/user/repos?per_page=100&sort=pushed&affiliation=owner,organization_member`,
      {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'skillet-sync',
          'x-github-api-version': '2022-11-28',
          authorization: `Bearer ${token}`,
        },
      },
    );
    if (!res.ok) return [];
    const body = (await res.json()) as GhRepo[];
    return body
      .filter((r) => (r.permissions?.push || r.permissions?.admin) && !r.archived && r.full_name)
      .map((r) => ({
        full: r.full_name as string,
        owner: r.owner?.login ?? (r.full_name as string).split('/')[0]!,
        name: r.name ?? (r.full_name as string).split('/')[1]!,
        private: r.private === true,
        pushedAt: r.pushed_at ?? null,
      }));
  } catch {
    return [];
  }
}

export interface GithubUser {
  login: string;
  name: string | null;
}

/**
 * The authenticated GitHub user behind a token (GET /user) — their login and
 * display name, for showing the real GitHub identity on the connection card.
 * Returns null on any failure so the caller degrades to the login alone.
 */
export async function getGithubUser(
  token: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<GithubUser | null> {
  try {
    const res = await fetchImpl(`${GH_API}/user`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'skillet-sync',
        'x-github-api-version': '2022-11-28',
        authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { login?: string; name?: string | null };
    return body.login ? { login: body.login, name: body.name ?? null } : null;
  } catch {
    return null;
  }
}

export interface RepoOwnership {
  ownsRepo: boolean;
  defaultBranch: string | null;
  private: boolean;
}

/**
 * Verify the token can administer/push to owner/repo. Requires `push` or `admin`
 * permission — the gate that makes "only your own repo" real. 404 (private or
 * nonexistent to this token) → not owned.
 */
export async function verifyRepoOwnership(
  owner: string,
  repo: string,
  token: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<RepoOwnership> {
  const res = await fetchImpl(`${GH_API}/repos/${owner}/${repo}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'skillet-sync',
      'x-github-api-version': '2022-11-28',
      authorization: `Bearer ${token}`,
    },
  });
  if (res.status === 404) return { ownsRepo: false, defaultBranch: null, private: false };
  if (!res.ok) throw new Error(`GitHub repo check failed (HTTP ${res.status})`);
  const body = (await res.json()) as {
    default_branch?: string;
    private?: boolean;
    permissions?: { admin?: boolean; push?: boolean };
  };
  const perms = body.permissions ?? {};
  return {
    ownsRepo: perms.admin === true || perms.push === true,
    defaultBranch: body.default_branch ?? null,
    private: body.private === true,
  };
}
