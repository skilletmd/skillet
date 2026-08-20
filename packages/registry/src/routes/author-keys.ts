// Multi-key-per-author: bind, list, and revoke signing keys.
// Harden bind: PoP of new key (every bind) + co-sign by existing key
//            (non-first binds only) + bind-attempt rate limit.
// Defense-in-depth fast-follow:
//   1. Atomic nonce consume: conditional UPDATE (AND consumed_at IS NULL) + changes() check.
//   2. Nonce mint rate-limited via the same per-user window as bind attempts.
//      Expired nonces swept on each mint to bound table size.
//   3. Domain-separated PoP message: utf8("skillet-key-bind:v1:" + nonce + ":" + key_id).
//   4. key_id must equal hex(public_key_bytes) — enforced at bind.
//
// Trust model:
//   Nonce: GET /api/v1/auth/keys/nonce (rate-limited) always mints a 5-min
//          single-use nonce. Returns needs_cosign=false for first-key bind,
//          needs_cosign=true when the user already has ≥1 active key.
//   Bind:  requires active web session + verified email.
//          pop_nonce + pop_sig_new required on every bind.
//          Non-first binds also require pop_key_id + pop_sig (existing-key co-sign).
//          Both sigs sign utf8("skillet-key-bind:v1:" + nonce + ":" + key_id).
//   List:  returns all non-revoked keys for the authenticated user.
//   Revoke: marks a key revoked_at = now; takes effect immediately.
//
// Wire format:
//   GET    /api/v1/auth/keys/nonce
//          → { nonce: string, expires_at: number, needs_cosign: boolean }
//            needs_cosign=false → first-key path; only pop_sig_new needed at bind.
//            needs_cosign=true  → send pop_key_id + pop_sig as well.
//   POST   /api/v1/auth/keys
//          { public_key, key_id, label?,
//            pop_nonce, pop_sig_new,               // always required
//            pop_key_id?, pop_sig? }               // required when needs_cosign=true
//   GET    /api/v1/auth/keys
//   DELETE /api/v1/auth/keys/:key_id
import { KEY_BIND_POP_PREFIX } from '@skillet/protocol';
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { DatabaseSync } from '../db/sqlite-handle.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { newId } from '../db/index.js';
import { requireScope, requireSession } from '../auth/middleware.js';
import { verifyPopSignature } from '../auth/signature.js';
import { requireKeyBindRateLimit } from '../ratelimit/key-bind.js';
const MAX_KEYS_PER_USER = 10;
const ED25519_RAW_PUB_BYTES = 32;
const KEY_ID_RE = /^[0-9a-f]{64}$/;
const POP_NONCE_TTL_SECONDS = 300; // 5 minutes
interface BindBody {
    public_key?: unknown;
    key_id?: unknown;
    label?: unknown;
    // Always required (new-key PoP).
    pop_nonce?: unknown;
    pop_sig_new?: unknown;
    // Required only when needs_cosign=true (non-first binds).
    pop_key_id?: unknown;
    pop_sig?: unknown;
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerAuthorKeyRoutes(app: FastifyInstance, db: DatabaseSync, prismaArg?: PrismaClient): void {
    const prisma = requirePrisma(
      prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
    )
    // GET /api/v1/auth/keys/nonce — mint a single-use nonce for the upcoming bind.
    // Item 2: rate-limited (same per-user window as bind attempts) to prevent
    // a leaked session from minting unbounded nonce rows. Expired nonces are swept
    // before inserting to keep the key_bind_nonces table bounded.
    app.get('/api/v1/auth/keys/nonce', { preHandler: [requireScope('claim'), requireKeyBindRateLimit(db, prisma)] }, async (req, reply) => {
        const principal = req.principal as {
            class: 'session';
            user_id: string;
        };
        const now = Math.floor(Date.now() / 1000);
        await prisma.key_bind_nonces.deleteMany({
            where: { user_id: principal.user_id, expires_at: { lt: now } },
        });
        const keyCount = await prisma.author_keys.count({
            where: { user_id: principal.user_id, revoked_at: null },
        });
        const nonce = randomBytes(32).toString('hex');
        const expiresAt = now + POP_NONCE_TTL_SECONDS;
        await prisma.key_bind_nonces.create({
            data: {
                id: randomUUID(),
                user_id: principal.user_id,
                nonce,
                expires_at: expiresAt,
            },
        });
        return reply.code(200).send({
            nonce,
            expires_at: expiresAt,
            needs_cosign: keyCount >= 1,
        });
    });
    // POST /api/v1/auth/keys — bind a new browser-generated public key.
    app.post<{
        Body: BindBody;
    }>('/api/v1/auth/keys', { preHandler: [requireScope('claim'), requireKeyBindRateLimit(db, prisma)] }, async (req, reply) => {
        const principal = req.principal as {
            class: 'session';
            user_id: string;
        };
        const { public_key, key_id, label, pop_nonce, pop_sig_new, pop_key_id, pop_sig } = req.body ?? {};
        if (typeof public_key !== 'string' || !public_key) {
            return reply.code(400).send({ error: 'public_key_required' });
        }
        if (typeof key_id !== 'string' || !KEY_ID_RE.test(key_id)) {
            return reply.code(400).send({
                error: 'invalid_key_id',
                message: 'key_id must be 64-char lowercase hex',
            });
        }
        let pkBuf: Buffer;
        try {
            pkBuf = Buffer.from(public_key, 'base64');
        }
        catch {
            return reply.code(400).send({ error: 'invalid_public_key' });
        }
        if (pkBuf.length !== ED25519_RAW_PUB_BYTES) {
            return reply.code(400).send({
                error: 'invalid_public_key',
                message: `Ed25519 public key must be ${ED25519_RAW_PUB_BYTES} bytes (got ${pkBuf.length})`,
            });
        }
        // Item 4: key_id must equal hex(raw_pub_bytes) — the §1.1 canonical form used
        // everywhere else in Skillet (publicKeyToKeyId in core, /claim storage, publish envelopes).
        const expectedKeyId = pkBuf.toString('hex');
        if (key_id !== expectedKeyId) {
            return reply.code(400).send({
                error: 'invalid_key_id',
                message: 'key_id must equal hex(public_key_bytes)',
            });
        }
        const resolvedLabel = typeof label === 'string' && label.trim() ? label.trim() : 'browser-key';
        const keyCount = await prisma.author_keys.count({
            where: { user_id: principal.user_id, revoked_at: null },
        });
        if (keyCount >= MAX_KEYS_PER_USER) {
            return reply.code(422).send({
                error: 'too_many_keys',
                message: `Cannot bind more than ${MAX_KEYS_PER_USER} active keys. Revoke an existing key first.`,
            });
        }
        // New-key PoP is required on every bind.
        // pop_nonce + pop_sig_new must always be present.
        if (typeof pop_nonce !== 'string' || typeof pop_sig_new !== 'string') {
            return reply.code(422).send({
                error: 'pop_required',
                message: 'Every key bind requires proof-of-possession of the new key. ' +
                    'Call GET /api/v1/auth/keys/nonce first, sign the nonce with the new key, ' +
                    'and include pop_nonce and pop_sig_new in this request.',
            });
        }
        // Validate nonce: must exist, belong to this user, be unconsumed and unexpired.
        const now = Math.floor(Date.now() / 1000);
        const nonceRow = await prisma.key_bind_nonces.findFirst({
            where: { user_id: principal.user_id, nonce: pop_nonce },
            select: { id: true, expires_at: true, consumed_at: true },
        });
        if (!nonceRow) {
            return reply.code(422).send({
                error: 'pop_invalid',
                message: 'pop_nonce not found or not issued for this user.',
            });
        }
        if (nonceRow.consumed_at !== null) {
            return reply.code(422).send({
                error: 'pop_invalid',
                message: 'pop_nonce has already been used.',
            });
        }
        if (nonceRow.expires_at < now) {
            return reply.code(422).send({
                error: 'pop_invalid',
                message: 'pop_nonce has expired. Request a new one.',
            });
        }
        const newKeySigValid = verifyPopSignature(pop_nonce, key_id, public_key, pop_sig_new);
        if (!newKeySigValid) {
            return reply.code(422).send({
                error: 'pop_invalid',
                message: `pop_sig_new does not verify. Sign utf8("${KEY_BIND_POP_PREFIX}" + nonce + ":" + key_id) ` +
                    'with the private key corresponding to the submitted public_key.',
            });
        }
        if (keyCount >= 1) {
            if (typeof pop_key_id !== 'string' || typeof pop_sig !== 'string') {
                return reply.code(422).send({
                    error: 'pop_required',
                    message: 'Binding a second or subsequent key also requires co-sign by an existing active key. ' +
                        'Include pop_key_id and pop_sig signed over the same domain-separated message.',
                });
            }
            if (!KEY_ID_RE.test(pop_key_id)) {
                return reply.code(422).send({
                    error: 'pop_invalid',
                    message: 'pop_key_id must be 64-char lowercase hex.',
                });
            }
            const popKeyRow = await prisma.author_keys.findFirst({
                where: {
                    user_id: principal.user_id,
                    key_id: pop_key_id,
                    revoked_at: null,
                },
                select: { public_key: true },
            });
            if (!popKeyRow) {
                return reply.code(422).send({
                    error: 'pop_invalid',
                    message: 'pop_key_id does not match any non-revoked key bound to this account.',
                });
            }
            const cosignValid = verifyPopSignature(pop_nonce, key_id, popKeyRow.public_key, pop_sig);
            if (!cosignValid) {
                return reply.code(422).send({
                    error: 'pop_invalid',
                    message: `pop_sig does not verify. Sign utf8("${KEY_BIND_POP_PREFIX}" + nonce + ":" + key_id) ` +
                        'with the private key corresponding to pop_key_id.',
                });
            }
        }
        const consume = await prisma.key_bind_nonces.updateMany({
            where: { id: nonceRow.id, consumed_at: null },
            data: { consumed_at: now },
        });
        if (consume.count !== 1) {
            return reply.code(422).send({
                error: 'pop_invalid',
                message: 'pop_nonce has already been used.',
            });
        }
        const existing = await prisma.author_keys.findFirst({
            where: { user_id: principal.user_id, key_id },
            select: { id: true },
        });
        if (existing) {
            return reply.code(409).send({
                error: 'key_already_bound',
                message: 'This key_id is already bound to your account.',
            });
        }
        const id = newId();
        await prisma.author_keys.create({
            data: {
                id,
                user_id: principal.user_id,
                key_id,
                public_key,
                label: resolvedLabel,
                created_at: now,
            },
        });
        const bindPayload = JSON.stringify({
            key_id,
            label: resolvedLabel,
            author_key_row_id: id,
        });
        process.stdout.write(JSON.stringify({
            kind: 'author_key_bound',
            user_id: principal.user_id,
            key_id,
            label: resolvedLabel,
        }) + '\n');
        await prisma.alerts.create({
            data: {
                id: randomUUID(),
                kind: 'author_key_bound',
                user_id: principal.user_id,
                payload_json: bindPayload,
                raised_at: now,
            },
        });
        return reply.code(201).send({ id, key_id, label: resolvedLabel });
    });
    // GET /api/v1/auth/keys — list all non-revoked keys for the authenticated user.
    app.get('/api/v1/auth/keys', { preHandler: requireSession }, async (req, reply) => {
        const principal = req.principal as {
            class: 'session';
            user_id: string;
        };
        const rows = await prisma.author_keys.findMany({
            where: { user_id: principal.user_id, revoked_at: null },
            orderBy: { created_at: 'asc' },
            select: {
                id: true,
                key_id: true,
                public_key: true,
                label: true,
                created_at: true,
            },
        });
        return reply.code(200).send({
            keys: rows.map((r) => ({
                id: r.id,
                key_id: r.key_id,
                public_key: r.public_key,
                label: r.label,
                created_at: r.created_at,
            })),
        });
    });
    // DELETE /api/v1/auth/keys/:key_id — revoke a bound key immediately.
    app.delete<{
        Params: {
            key_id: string;
        };
    }>('/api/v1/auth/keys/:key_id', { preHandler: requireSession }, async (req, reply) => {
        const principal = req.principal as {
            class: 'session';
            user_id: string;
        };
        const { key_id } = req.params;
        const row = await prisma.author_keys.findFirst({
            where: { user_id: principal.user_id, key_id, revoked_at: null },
            select: { id: true },
        });
        if (!row) {
            return reply.code(404).send({
                error: 'key_not_found',
                message: 'No active key with that key_id found for your account.',
            });
        }
        const activeCount = await prisma.author_keys.count({
            where: { user_id: principal.user_id, revoked_at: null },
        });
        if (activeCount <= 1) {
            return reply.code(422).send({
                error: 'cannot_revoke_last_key',
                message: 'Cannot revoke your only active signing key. Bind a new key first, then revoke this one.',
            });
        }
        const now = Math.floor(Date.now() / 1000);
        const revoke = await prisma.author_keys.updateMany({
            where: { id: row.id, user_id: principal.user_id, revoked_at: null },
            data: { revoked_at: now },
        });
        if (revoke.count === 0) {
            return reply.code(422).send({
                error: 'cannot_revoke_last_key',
                message: 'Cannot revoke your only active signing key. Bind a new key first, then revoke this one.',
            });
        }
        const revokePayload = JSON.stringify({ key_id, author_key_row_id: row.id });
        process.stdout.write(JSON.stringify({
            kind: 'author_key_revoked',
            user_id: principal.user_id,
            key_id,
        }) + '\n');
        await prisma.alerts.create({
            data: {
                id: randomUUID(),
                kind: 'author_key_revoked',
                user_id: principal.user_id,
                payload_json: revokePayload,
                raised_at: now,
            },
        });
        return reply.code(204).send();
    });
}
