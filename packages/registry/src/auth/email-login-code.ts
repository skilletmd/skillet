// Email login codes — the OAuth-first passwordless web sign-in fallback.
//
// Dedicated store (`email_login_codes`), deliberately NOT `magic_link_tokens`:
// the magic-link pipe is being retired, so this must not depend on it. A 6-digit
// code is hashed (bound to its email so a row can't be replayed for another
// address), stored with a 10-minute expiry, single-use on verify, and locked
// after a few wrong attempts. Codes are scanner-proof and cross-device — the
// session mints where the user types the code, not where the email opened.
import type { FastifyInstance } from 'fastify';
import { createHash, randomInt } from 'node:crypto';
import { newId } from '../db/index.js';
import type { PrismaDb } from '../db/prisma-client.js';
import { mintToken } from './tokens.js';
import {
  upsertIdentityUserPrisma,
  type MintedUserSession,
  type WebIdentityInput,
} from './identities.js';
import { mailDeliveryConfigured, sendLoginCodeEmail } from './magic-link-mail.js';
import { loginCodeSendDecisionPrisma } from '../ratelimit/login-code.js';
import type { PrismaClient } from '@prisma/client';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_TTL_SEC = 10 * 60;
const CODE_DIGITS = 6;

/** Wrong-code attempts allowed on a single code before it locks. */
export const MAX_LOGIN_CODE_ATTEMPTS = 5;

/**
 * Mask an email for logs (#471): keep the first local-part char and the full
 * domain, e.g. `alice@example.com` -> `a***@example.com`. Never write the raw
 * address to logs, which may ship to an aggregator. Exported for tests.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : null;
}

/** Unbiased 6-digit numeric code (randomInt avoids modulo bias). */
function generateCode(): string {
  let out = '';
  for (let i = 0; i < CODE_DIGITS; i++) out += String(randomInt(0, 10));
  return out;
}

/** Hash bound to the email, so a code is only valid for the address it was sent to. */
export function hashLoginCode(email: string, code: string): string {
  return createHash('sha256').update(`logincode:${email}:${code.trim()}`).digest('hex');
}

function sessionTtlSec(): number {
  const raw = process.env.SKILLET_SESSION_TTL_SEC;
  const fallback = 14 * 86400;
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

async function mintSessionPrisma(prisma: PrismaDb, userId: string) {
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
  return { session_token: secret, expires_at: expiresAt };
}

/**
 * Store a hashed email login code (Prisma / MySQL). Callers pass a normalized
 * email and plaintext code; we only persist the email-bound hash.
 */
export async function storeEmailLoginCodePrisma(
  prisma: PrismaDb,
  opts: {
    email: string;
    code: string;
    requestIp?: string | null;
    now?: number;
  },
): Promise<{ id: string; expires_at: number }> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const id = newId();
  const expires_at = now + CODE_TTL_SEC;
  await prisma.email_login_codes.create({
    data: {
      id,
      email: opts.email,
      code_hash: hashLoginCode(opts.email, opts.code),
      request_ip: opts.requestIp ?? null,
      expires_at,
      created_at: now,
    },
  });
  return { id, expires_at };
}

export type VerifyEmailLoginCodePrismaOk = {
  ok: true;
  user: MintedUserSession;
  session_token: string;
  expires_at: number;
};

export type VerifyEmailLoginCodePrismaErr = {
  ok: false;
  error: 'invalid_or_expired_code' | 'too_many_attempts';
};

/**
 * Verify a login code, burn it, upsert the email identity, and mint a session
 * (Prisma / MySQL). Mirrors the /login-code/verify route body without HTTP.
 */
export async function verifyEmailLoginCodePrisma(
  prisma: PrismaDb,
  opts: {
    email: string;
    code: string;
    now?: number;
  },
): Promise<VerifyEmailLoginCodePrismaOk | VerifyEmailLoginCodePrismaErr> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const code = opts.code.trim();

  const row = await prisma.email_login_codes.findFirst({
    where: {
      email: opts.email,
      consumed_at: null,
      expires_at: { gte: now },
    },
    orderBy: { created_at: 'desc' },
    select: { id: true, code_hash: true, attempts: true },
  });
  if (!row) return { ok: false, error: 'invalid_or_expired_code' };
  if (row.attempts >= MAX_LOGIN_CODE_ATTEMPTS) {
    return { ok: false, error: 'too_many_attempts' };
  }

  if (!/^\d{6}$/.test(code) || hashLoginCode(opts.email, code) !== row.code_hash) {
    await prisma.email_login_codes.update({
      where: { id: row.id },
      data: { attempts: { increment: 1 } },
    });
    return { ok: false, error: 'invalid_or_expired_code' };
  }

  const burn = await prisma.email_login_codes.updateMany({
    where: { id: row.id, consumed_at: null },
    data: { consumed_at: now },
  });
  if (burn.count === 0) return { ok: false, error: 'invalid_or_expired_code' };

  const identity: WebIdentityInput = {
    provider: 'email',
    provider_subject_id: opts.email,
    email: opts.email,
    email_verified: true,
  };
  const user = await upsertIdentityUserPrisma(prisma, identity);
  const session = await mintSessionPrisma(prisma, user.user_id);
  return {
    ok: true,
    user,
    session_token: session.session_token,
    expires_at: session.expires_at,
  };
}

interface SendBody {
  email?: string;
}

interface VerifyBody {
  email?: string;
  code?: string;
}

export function registerEmailLoginCodeRoutes(
  app: FastifyInstance,
  _db: unknown,
  prisma?: PrismaClient,
  devAuth = false,
): void {
  app.post<{ Body: SendBody }>('/api/v1/auth/login-code/send', async (req, reply) => {
    if (!prisma) {
      throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
    }
    const email = normalizeEmail(req.body?.email ?? '');
    if (!email) {
      return reply.code(400).send({ error: 'invalid_email' });
    }

    const now = Math.floor(Date.now() / 1000);
    const requestIp = req.ip || 'unknown';
    // Per-email + per-IP caps plus a global botnet backstop. Uniform 429 without
    // revealing which key tripped (no account-existence leak).
    const decision = await loginCodeSendDecisionPrisma(prisma, { email, ip: requestIp, now });
    if (!decision.allowed) {
      if (decision.scope === 'global') {
        req.log.warn(
          { scope: 'global' },
          'login-code send global rate limit tripped; possible abuse; investigate',
        );
      }
      return reply.code(429).send({
        error: 'rate_limited',
        message: 'Too many sign-in code requests. Try again shortly.',
      });
    }

    const code = generateCode();
    await storeEmailLoginCodePrisma(prisma, {
      email,
      code,
      requestIp,
      now,
    });

    if (mailDeliveryConfigured()) {
      const mailed = await sendLoginCodeEmail({ to: email, code });
      if (!mailed.ok) {
        req.log.error(
          { err: mailed.error, email: maskEmail(email) },
          'login-code email delivery failed',
        );
      }
    }

    // Uniform response: never leak whether the mailbox exists. The code is
    // surfaced to the caller ONLY when dev auth is explicitly enabled (in-memory
    // DB or SKILLET_ENABLE_DEV_AUTH=1), mirroring the dev session minter — never
    // on the mere absence of NODE_ENV==='production', which a self-host trips into.
    return reply.send({
      ok: true,
      message: 'If that address is valid, we sent a sign-in code.',
      ...(devAuth ? { dev_code: code } : {}),
    });
  });

  app.post<{ Body: VerifyBody }>('/api/v1/auth/login-code/verify', async (req, reply) => {
    if (!prisma) {
      throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
    }
    const email = normalizeEmail(req.body?.email ?? '');
    if (!email) {
      return reply.code(400).send({ error: 'invalid_email' });
    }
    const code = (req.body?.code ?? '').trim();
    const now = Math.floor(Date.now() / 1000);

    const result = await verifyEmailLoginCodePrisma(prisma, { email, code, now });
    if (!result.ok) {
      if (result.error === 'too_many_attempts') {
        return reply.code(400).send({
          error: 'too_many_attempts',
          message: 'Too many wrong codes. Request a new one.',
        });
      }
      return reply.code(400).send({ error: 'invalid_or_expired_code' });
    }
    return reply.send({
      ok: true,
      session_token: result.session_token,
      expires_at: result.expires_at,
    });
  });
}
