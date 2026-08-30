// Web BFF session mint + provider link endpoints.
//
// SECURITY: these routes let the trusted web BFF mint/link sessions for ANY
// account. They MUST NEVER be internet-routable — they sit behind the private
// network and the browser BFF proxy blocks the /auth/web + /auth/link paths and
// strips the x-skillet-web-* signing headers. The BFF proves itself with an HMAC
// request signature (see ./web-internal-sig.ts), NOT a raw shared secret.
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { DatabaseSync } from '../db/sqlite-handle.js'
import { mintToken } from './tokens.js';
import { requireSession } from './middleware.js';
import { verifyWebInternalSignature } from './web-internal-sig.js';
import { newId } from '../db/index.js';
import {
  upsertIdentityUserPrisma,
  userHasGithubIdentityPrisma,
  userLinkedProvidersPrisma,
  type IdentityProvider,
  type WebIdentityInput,
} from './identities.js';
import {
  storeUserGithubTokenPrisma,
  userHasGithubTokenPrisma,
} from '../sync/github-token.js';

interface WebSessionBody {
  provider?: string;
  provider_subject_id?: string;
  email?: string;
  email_verified?: boolean;
  login?: string;
  two_factor?: boolean;
  display_name?: string;
  avatar_url?: string;
  /** GitHub OAuth access token from the BFF's sign-in, stored read-only for repo
   *  reuse so the user never needs a second GitHub grant. GitHub provider only. */
  provider_token?: string;
}

interface LinkIdentityBody {
  provider?: string;
  provider_subject_id?: string;
  email?: string;
  email_verified?: boolean;
  login?: string;
  two_factor?: boolean;
  display_name?: string;
  avatar_url?: string;
  /** See WebSessionBody.provider_token. */
  provider_token?: string;
}

const PROVIDERS = new Set<IdentityProvider>(['github', 'google', 'email', 'twitter']);

function sessionTtlSec(): number {
  const raw =
    process.env.SKILLET_SESSION_TTL_SEC;
  const fallback = 14 * 86400;
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// The trusted web BFF proves itself by HMAC-signing the request (canonical string
// over method/path/query/body/ts/nonce) — see ./web-internal-sig.ts. This replaces
// the former raw shared secret: holding the secret alone no longer mints a session,
// because each call must be freshly signed, is timestamped (±30s), and is
// single-use (nonce replay rejected). The session token (when present, e.g.
// /auth/link) still rides in `Authorization` and is verified separately; the
// signature proves BFF origin so a raw session holder replaying their cookie cannot
// reach these write paths.
function webInternalAuthorized(req: FastifyRequest, devAuth: boolean): boolean {
  return verifyWebInternalSignature({
    method: req.method,
    url: req.url,
    body: req.body ?? {},
    headers: req.headers,
    devAuth,
  });
}

function parseWebIdentity(body: WebSessionBody | LinkIdentityBody): WebIdentityInput | null {
  const provider = body.provider;
  if (!provider || !PROVIDERS.has(provider as IdentityProvider)) return null;
  const subject = body.provider_subject_id?.trim();
  if (!subject) return null;
  return {
    provider: provider as IdentityProvider,
    provider_subject_id: subject,
    email: body.email ?? null,
    // The BFF (Auth.js) tells us whether the IdP verified the email.
    // GitHub is always treated as verified downstream; Google passes through.
    email_verified: body.email_verified === true,
    login: body.login ?? null,
    two_factor: body.two_factor === true,
    display_name: body.display_name ?? null,
    avatar_url: body.avatar_url ?? null,
  };
}

/**
 * Persist the GitHub OAuth token (read-only) for reuse, if this sign-in/link
 * carried one. GitHub provider only — other providers never send a token, and we
 * never store one for them. Best-effort: a token write must not fail the sign-in.
 */
async function captureGithubTokenPrisma(
  prisma: PrismaClient,
  userId: string,
  identity: WebIdentityInput,
  rawToken: string | undefined,
  log: FastifyBaseLogger,
): Promise<void> {
  if (identity.provider !== 'github') return;
  const token = rawToken?.trim();
  if (!token) return;
  try {
    await storeUserGithubTokenPrisma(prisma, userId, token);
  } catch (err) {
    // The identity row is already committed by the time we get here, so letting
    // this throw 500s the link AFTER the account is linked: the user is told
    // "Connected GitHub." while every token-backed surface (owned repos, the
    // GitHub login on the connection card) stays empty, with nothing on the page
    // to explain it. A missing SKILLET_REPO_TOKEN_KEY did exactly that in
    // production. Swallow and log instead, per this function's contract.
    log.error(
      { err, user_id: userId },
      'github token capture failed; account linked without a stored token',
    );
  }
}

export function mintSessionForUser(
  _db: DatabaseSync,
  _userId: string,
): { session_id: string; session_token: string; expires_at: number } {
  throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
}

export async function mintSessionForUserPrisma(
  prisma: PrismaClient,
  userId: string,
): Promise<{ session_id: string; session_token: string; expires_at: number }> {
  const sessionId = newId();
  const { secret, hash } = mintToken('session');
  const expiresAt = Math.floor(Date.now() / 1000) + sessionTtlSec();
  await prisma.sessions.create({
    data: {
      id: sessionId,
      user_id: userId,
      token_hash: hash,
      expires_at: expiresAt,
    },
  });
  return { session_id: sessionId, session_token: secret, expires_at: expiresAt };
}

export function registerWebAuthRoutes(
  app: FastifyInstance,
  db: DatabaseSync,
  opts: { devAuth?: boolean; prisma?: PrismaClient } = {},
): void {
  // Fail closed: when no web-internal secret is configured, these session-minting
  // endpoints open ONLY under the explicit dev-auth gate (computed in server.ts:
  // in-memory DB or SKILLET_ENABLE_DEV_AUTH=1), never on NODE_ENV alone.
  const devAuth = opts.devAuth === true;
  const prisma = opts.prisma;

  // Trusted web BFF mints a registry session after Auth.js verifies the IdP.
  app.post<{ Body: WebSessionBody }>(
    '/api/v1/auth/web/session',
    async (req, reply) => {
      if (!webInternalAuthorized(req, devAuth)) {
        return reply.code(401).send({ error: 'web_internal_auth_required' });
      }

      const identity = parseWebIdentity(req.body ?? {});
      if (!identity) {
        return reply.code(400).send({ error: 'invalid_identity' });
      }

      if (prisma) {
        const user = await upsertIdentityUserPrisma(prisma, identity);
        await captureGithubTokenPrisma(prisma, user.user_id, identity, req.body?.provider_token, req.log);
        const session = await mintSessionForUserPrisma(prisma, user.user_id);
        return reply.send({
          session_token: session.session_token,
          session_id: session.session_id,
          expires_at: session.expires_at,
          user_id: user.user_id,
          handle: user.handle,
          email: user.email,
          two_factor: user.two_factor,
          linked_providers: user.linked_providers,
          github_linked: await userHasGithubIdentityPrisma(prisma, user.user_id),
          github_token_present: await userHasGithubTokenPrisma(prisma, user.user_id),
        });
      }

    },
  );

  // Re-issue a registry session for an ALREADY-LINKED identity, with ZERO side
  // effects: no user creation, no identity write, no profile/2FA mutation. The
  // trusted web BFF calls this server-to-server when a still-valid web session's
  // registry session has expired, so the user self-heals instead of being bounced
  // to re-login. It refuses unknown identities — user/session creation only ever
  // happens via /web/session at a real, IdP-verified sign-in. (Never browser
  // reachable: the BFF proxy blocks `api/v1/auth/web/*`.)
  app.post<{
    Body: { provider?: string; provider_subject_id?: string; expected_user_id?: string };
  }>(
    '/api/v1/auth/web/session/refresh',
    async (req, reply) => {
      if (!webInternalAuthorized(req, devAuth)) {
        return reply.code(401).send({ error: 'web_internal_auth_required' });
      }

      const provider = req.body?.provider;
      const subjectId = req.body?.provider_subject_id;
      if (!provider || !PROVIDERS.has(provider as IdentityProvider) || !subjectId) {
        return reply.code(400).send({ error: 'invalid_identity' });
      }

      // Account binding: the BFF must say which user it expects this identity to
      // resolve to (sourced from its verified web JWT). A missing expectation
      // fails closed; a mismatch refuses to mint — so a stale/contested identity
      // can never refresh a session for the wrong account.
      const expectedUserId = req.body?.expected_user_id;
      if (!expectedUserId) {
        return reply.code(400).send({ error: 'expected_user_id_required' });
      }

      if (prisma) {
        const row = await prisma.user_identities.findFirst({
          where: { provider, provider_subject_id: subjectId },
          select: { user_id: true },
        });
        if (!row) {
          return reply.code(401).send({ error: 'identity_unknown' });
        }
        if (row.user_id !== expectedUserId) {
          return reply.code(401).send({ error: 'identity_user_mismatch' });
        }
        const session = await mintSessionForUserPrisma(prisma, row.user_id);
        return reply.send({
          session_token: session.session_token,
          session_id: session.session_id,
          expires_at: session.expires_at,
          user_id: row.user_id,
        });
      }

    },
  );

  // Attach a second provider to the calling user's account.
  app.post<{ Body: LinkIdentityBody }>(
    '/api/v1/auth/link',
    { preHandler: requireSession },
    async (req, reply) => {
      if (req.principal?.class !== 'session') {
        return reply.code(403).send({ error: 'wrong_token_class' });
      }

      // identity.email becomes an authorization fact (e.g. email-invite accept),
      // so only the trusted BFF may write it — never a raw session holder. The
      // user's session rides in `Authorization` (verified by requireSession); the
      // BFF additionally signs the request, which a raw session holder cannot.
      if (!webInternalAuthorized(req, devAuth)) {
        return reply.code(401).send({ error: 'web_internal_auth_required' });
      }

      const identity = parseWebIdentity(req.body ?? {});
      if (!identity) {
        return reply.code(400).send({ error: 'invalid_identity' });
      }

      if (prisma) {
        const existing = await prisma.user_identities.findFirst({
          where: {
            provider: identity.provider,
            provider_subject_id: identity.provider_subject_id,
          },
          select: { user_id: true },
        });
        if (existing && existing.user_id !== req.principal.user_id) {
          return reply.code(409).send({ error: 'identity_already_linked' });
        }
        const user = await upsertIdentityUserPrisma(prisma, identity, req.principal.user_id);
        await captureGithubTokenPrisma(prisma, user.user_id, identity, req.body?.provider_token, req.log);
        return reply.send({
          user_id: user.user_id,
          handle: user.handle,
          email: user.email,
          two_factor: user.two_factor,
          linked_providers: user.linked_providers,
          github_linked: await userHasGithubIdentityPrisma(prisma, user.user_id),
          github_token_present: await userHasGithubTokenPrisma(prisma, user.user_id),
        });
      }

    },
  );

  // Unlink a provider identity from the calling user. Fail-closed lockout guard:
  // never remove the user's LAST sign-in method (that would orphan the account).
  // For GitHub, also drop the stored read-only token + github_id — the token came
  // from this identity. Connected repos are managed separately (/settings/github)
  // and keep their own per-repo tokens, so they're left untouched here.
  app.delete<{ Body: { provider?: string } }>(
    '/api/v1/auth/link',
    { preHandler: requireSession },
    async (req, reply) => {
      if (req.principal?.class !== 'session') {
        return reply.code(403).send({ error: 'wrong_token_class' });
      }
      if (!webInternalAuthorized(req, devAuth)) {
        return reply.code(401).send({ error: 'web_internal_auth_required' });
      }

      const provider = req.body?.provider;
      if (!provider || !PROVIDERS.has(provider as IdentityProvider)) {
        return reply.code(400).send({ error: 'invalid_provider' });
      }

      if (prisma) {
        const current = await userLinkedProvidersPrisma(prisma, req.principal.user_id);
        if (!current.includes(provider as IdentityProvider)) {
          return reply.code(404).send({ error: 'not_linked' });
        }
        if (current.filter((p) => p !== provider).length === 0) {
          return reply.code(409).send({
            error: 'last_identity',
            message: 'You can’t remove your only sign-in method.',
          });
        }
        await prisma.user_identities.deleteMany({
          where: { user_id: req.principal.user_id, provider },
        });
        if (provider === 'github') {
          await prisma.users.update({
            where: { id: req.principal.user_id },
            data: { github_id: null },
          });
          await prisma.user_github_tokens.deleteMany({
            where: { user_id: req.principal.user_id },
          });
        }
        return reply.send({
          ok: true,
          linked_providers: await userLinkedProvidersPrisma(prisma, req.principal.user_id),
          github_linked: await userHasGithubIdentityPrisma(prisma, req.principal.user_id),
        });
      }

    },
  );
}
