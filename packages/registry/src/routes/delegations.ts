// Device-key delegation endpoints (design §2.3 / §3).
//
//   POST /api/v1/delegations                         register a signed delegation
//   GET  /api/v1/delegations                          list the caller's delegations
//   PATCH /api/v1/delegations/:device_key_id            update display label
//   POST /api/v1/delegations/:device_key_id/revoke    author-signed revocation
//   POST /api/v1/delegations/:device_key_id/revoke-session  session-owner cleanup
//
// The registry stores delegations but is never the root of trust: every field
// that grants authority is covered by the author primary-key signature, which is
// re-verified here (registration) and at every use (resolveAndVerifySigner).
// These handlers hardcode `/api/v1/...` and register at the root level, mirroring
// routes/auth.ts (outside the version-prefix mount).
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { DatabaseSync } from '../db/sqlite-handle.js';
import { type DelegationCert, type RevocationStatement, DELEGATION_REVOCATION_TYP, DELEGATION_CERT_VERSION, canonicalJson, delegationCertHash, revocationHash, validateDelegationCert, } from '@skillet/protocol';
import { verifyPublishSignature, type Signature } from '../auth/signature.js';
import { requireScope, requireSession } from '../auth/middleware.js';
interface RegisterDelegationBody {
    cert?: unknown;
    cert_sig?: Signature;
    label?: string;
}
interface RevokeBody {
    revocation?: unknown;
    revocation_sig?: Signature;
}
interface PatchDelegationBody {
    label?: string;
}
const KEY_ID_RE = /^[0-9a-f]{64}$/;
const NONCE_RE = /^[0-9a-f]{32}$/;
const LABEL_MAX = 120;

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerDelegationRoutes(app: FastifyInstance, db: DatabaseSync, prismaArg?: PrismaClient): void {
    const prisma = requirePrisma(
      prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
    )
    // --------------------------------------------------------------------------
    // POST /api/v1/delegations — register a delegation.
    //
    // Same gate as /claim (session + IdP-verified email): a new device key is new
    // authority, so it must clear the publish/claim verification gate.
    // --------------------------------------------------------------------------
    app.post<{
        Body: RegisterDelegationBody;
    }>('/api/v1/delegations', { preHandler: requireScope('claim') }, async (req, reply) => {
        const principal = req.principal as {
            user_id: string;
        };
        const { cert: certInput, cert_sig, label } = req.body ?? {};
        // Step 1: caller must have a registered primary key.
        const user = await prisma.users.findUnique({
            where: { id: principal.user_id },
            select: {
                author_public_key: true,
                author_key_id: true,
                handle: true,
            },
        });
        if (!user?.author_public_key || !user.author_key_id) {
            return reply.code(409).send({
                error: 'author_not_claimed',
                message: 'Register a primary author key with /api/v1/claim before delegating a device key.',
            });
        }
        // Step 3+4+5 (shape/policy): version, ids, device_key_id == hex(device_pub),
        // scopes ⊆ {propose,approve}, TTL within cap.
        const shape = validateDelegationCert(certInput);
        if (!('ok' in shape)) {
            return reply.code(400).send({ error: shape.code, message: shape.message });
        }
        const cert: DelegationCert = shape.cert;
        // Step 2: cert must bind to THIS author's primary key + handle, and the
        // cert_sig must claim the same primary key id.
        if (!cert_sig || typeof cert_sig !== 'object' || typeof cert_sig.key_id !== 'string') {
            return reply.code(400).send({ error: 'cert_sig_required', message: 'cert_sig envelope is required' });
        }
        if (cert.author_key_id !== user.author_key_id ||
            cert_sig.key_id !== user.author_key_id) {
            return reply.code(403).send({
                error: 'author_mismatch',
                message: 'cert.author_key_id and cert_sig.key_id must equal your registered primary key id.',
            });
        }
        if (user.handle != null && cert.handle !== user.handle) {
            return reply.code(403).send({
                error: 'author_mismatch',
                message: 'cert.handle must equal your registered handle.',
            });
        }
        // Step 6: recompute certHash and verify cert_sig against the PRIMARY pubkey
        // only (never the user's full author_keys set) — a delegation must chain to
        // the primary, not to a 219-bound key.
        const certHash = delegationCertHash(cert);
        const sigCheck = verifyPublishSignature(certHash, cert_sig, [
            { key_id: user.author_key_id, public_key: user.author_public_key },
        ]);
        if ('code' in sigCheck) {
            return reply.code(403).send({
                error: 'signature_invalid',
                message: `Delegation cert signature does not verify against your primary key: ${sigCheck.message}`,
            });
        }
        // Step 7: idempotent insert. A re-POST of the IDENTICAL cert → 200; a
        // DIFFERENT cert for an existing non-revoked device key → 409.
        const certJson = canonicalJson(cert);
        const existing = await prisma.author_delegations.findUnique({
            where: { device_key_id: cert.device_key_id },
            select: { cert_json: true, revoked_at: true },
        });
        if (existing) {
            if (existing.cert_json === certJson) {
                return reply.code(200).send({
                    device_key_id: cert.device_key_id,
                    expires_at: cert.expires_at,
                    scopes: cert.scopes,
                });
            }
            if (existing.revoked_at == null) {
                return reply.code(409).send({
                    error: 'device_key_in_use',
                    message: 'A different active delegation already exists for this device key id.',
                });
            }
            // A revoked row exists with a different cert: a revoked device key id is
            // burned. Re-enrolling requires a fresh device key (new key id).
            return reply.code(409).send({
                error: 'device_key_in_use',
                message: 'This device key id was revoked; enroll a new device key.',
            });
        }
        const cleanLabel = typeof label === 'string' && label.length > 0 ? label.slice(0, LABEL_MAX) : null;
        await prisma.author_delegations.create({
            data: {
                device_key_id: cert.device_key_id,
                user_id: principal.user_id,
                author_key_id: cert.author_key_id,
                device_pub: cert.device_pub,
                scopes: JSON.stringify(cert.scopes),
                cert_json: certJson,
                cert_sig_alg: cert_sig.alg,
                cert_sig_key_id: cert_sig.key_id,
                cert_sig_b64: cert_sig.sig,
                label: cleanLabel,
                issued_at: cert.issued_at,
                expires_at: cert.expires_at,
            },
        });
        return reply.code(201).send({
            device_key_id: cert.device_key_id,
            expires_at: cert.expires_at,
            scopes: cert.scopes,
        });
    });
    // --------------------------------------------------------------------------
    // GET /api/v1/delegations — list the caller's delegations (active + revoked).
    // Never returns other users' rows.
    // --------------------------------------------------------------------------
    app.get('/api/v1/delegations', { preHandler: requireSession }, async (req, reply) => {
        const principal = req.principal as {
            user_id: string;
        };
        const now = Math.floor(Date.now() / 1000);
        const rows = await prisma.author_delegations.findMany({
            where: { user_id: principal.user_id },
            orderBy: { created_at: 'desc' },
            select: {
                device_key_id: true,
                label: true,
                scopes: true,
                issued_at: true,
                expires_at: true,
                revoked_at: true,
            },
        });
        return reply.code(200).send({
            delegations: rows.map((r) => ({
                device_key_id: r.device_key_id,
                label: r.label,
                scopes: JSON.parse(r.scopes) as string[],
                issued_at: r.issued_at,
                expires_at: r.expires_at,
                revoked_at: r.revoked_at,
                status: r.revoked_at != null ? 'revoked' : r.expires_at < now ? 'expired' : 'active',
            })),
        });
    });
    // --------------------------------------------------------------------------
    // PATCH /api/v1/delegations/:device_key_id — rename a signing device label.
    // --------------------------------------------------------------------------
    app.patch<{
        Params: {
            device_key_id: string;
        };
        Body: PatchDelegationBody;
    }>('/api/v1/delegations/:device_key_id', { preHandler: requireSession }, async (req, reply) => {
        const principal = req.principal as {
            user_id: string;
        };
        const { device_key_id } = req.params;
        const { label } = req.body ?? {};
        if (typeof label !== 'string') {
            return reply.code(400).send({ error: 'label_required', message: 'label must be a string' });
        }
        const cleanLabel = label.trim().length > 0 ? label.trim().slice(0, LABEL_MAX) : null;
        const upd = await prisma.author_delegations.updateMany({
            where: { device_key_id, user_id: principal.user_id },
            data: { label: cleanLabel },
        });
        if (upd.count === 0) {
            return reply.code(404).send({ error: 'delegation_not_found' });
        }
        return reply.code(200).send({ device_key_id, label: cleanLabel });
    });
    // --------------------------------------------------------------------------
    // POST /api/v1/delegations/:device_key_id/revoke — author-signed revocation.
    //
    // The revocation must chain to the caller's primary key (only the primary key
    // can authorize state changes to the trust chain). Idempotent. 404 if the
    // device key is not the caller's.
    // --------------------------------------------------------------------------
    app.post<{
        Params: {
            device_key_id: string;
        };
        Body: RevokeBody;
    }>('/api/v1/delegations/:device_key_id/revoke', { preHandler: requireSession }, async (req, reply) => {
        const principal = req.principal as {
            user_id: string;
        };
        const { device_key_id } = req.params;
        const { revocation: revInput, revocation_sig } = req.body ?? {};
        const user = await prisma.users.findUnique({
            where: { id: principal.user_id },
            select: {
                author_public_key: true,
                author_key_id: true,
                handle: true,
            },
        });
        if (!user?.author_public_key || !user.author_key_id) {
            return reply.code(409).send({ error: 'author_not_claimed' });
        }
        // The device key must belong to the caller (existence-hiding: 404 either way).
        const row = await prisma.author_delegations.findFirst({
            where: { device_key_id, user_id: principal.user_id },
            select: { revoked_at: true },
        });
        if (!row) {
            return reply.code(404).send({ error: 'delegation_not_found' });
        }
        // Idempotent: already revoked → 200 with the existing revoked_at.
        if (row.revoked_at != null) {
            return reply.code(200).send({ device_key_id, revoked_at: row.revoked_at });
        }
        // Validate the revocation statement shape.
        if (!revInput || typeof revInput !== 'object') {
            return reply.code(400).send({ error: 'invalid_revocation', message: 'revocation must be an object' });
        }
        const rev = revInput as Record<string, unknown>;
        if (rev.v !== DELEGATION_CERT_VERSION) {
            return reply.code(400).send({ error: 'invalid_revocation', message: 'unsupported revocation version' });
        }
        if (rev.typ !== DELEGATION_REVOCATION_TYP) {
            return reply.code(400).send({ error: 'invalid_revocation', message: `typ must be ${DELEGATION_REVOCATION_TYP}` });
        }
        if (typeof rev.author_key_id !== 'string' || !KEY_ID_RE.test(rev.author_key_id)) {
            return reply.code(400).send({ error: 'invalid_revocation', message: 'author_key_id must be 64-char hex' });
        }
        if (typeof rev.device_key_id !== 'string' || rev.device_key_id !== device_key_id) {
            return reply.code(400).send({
                error: 'invalid_revocation',
                message: 'revocation.device_key_id must match the URL device key id',
            });
        }
        if (typeof rev.revoked_at !== 'number' || !Number.isInteger(rev.revoked_at)) {
            return reply.code(400).send({ error: 'invalid_revocation', message: 'revoked_at must be integer unix seconds' });
        }
        if (typeof rev.nonce !== 'string' || !NONCE_RE.test(rev.nonce)) {
            return reply.code(400).send({ error: 'invalid_revocation', message: 'nonce must be 32-char hex' });
        }
        // The revocation must chain to the caller's primary key.
        if (rev.author_key_id !== user.author_key_id) {
            return reply.code(403).send({
                error: 'author_mismatch',
                message: 'revocation.author_key_id must equal your registered primary key id.',
            });
        }
        if (!revocation_sig || typeof revocation_sig !== 'object' || revocation_sig.key_id !== user.author_key_id) {
            return reply.code(403).send({
                error: 'author_mismatch',
                message: 'revocation_sig.key_id must equal your registered primary key id.',
            });
        }
        const revStatement: RevocationStatement = {
            v: rev.v as number,
            typ: DELEGATION_REVOCATION_TYP,
            author_key_id: rev.author_key_id,
            device_key_id: rev.device_key_id,
            revoked_at: rev.revoked_at as number,
            nonce: rev.nonce,
        };
        const revHash = revocationHash(revStatement);
        const sigCheck = verifyPublishSignature(revHash, revocation_sig, [
            { key_id: user.author_key_id, public_key: user.author_public_key },
        ]);
        if ('code' in sigCheck) {
            return reply.code(403).send({
                error: 'signature_invalid',
                message: `Revocation signature does not verify against your primary key: ${sigCheck.message}`,
            });
        }
        const now = Math.floor(Date.now() / 1000);
        const upd = await prisma.author_delegations.updateMany({
            where: {
                device_key_id,
                user_id: principal.user_id,
                revoked_at: null,
            },
            data: {
                revoked_at: now,
                revocation_sig_b64: revocation_sig.sig,
                revocation_json: canonicalJson(revStatement),
            },
        });
        if (upd.count === 0) {
            const fresh = await prisma.author_delegations.findUnique({
                where: { device_key_id },
                select: { revoked_at: true },
            });
            return reply.code(200).send({ device_key_id, revoked_at: fresh?.revoked_at ?? now });
        }
        return reply.code(200).send({ device_key_id, revoked_at: now });
    });
    // --------------------------------------------------------------------------
    // POST /api/v1/delegations/:device_key_id/revoke-session — account-owner
    // cleanup from web without a primary-key signature. Idempotent.
    // --------------------------------------------------------------------------
    app.post<{
        Params: {
            device_key_id: string;
        };
    }>('/api/v1/delegations/:device_key_id/revoke-session', { preHandler: requireSession }, async (req, reply) => {
        const principal = req.principal as {
            user_id: string;
        };
        const { device_key_id } = req.params;
        const row = await prisma.author_delegations.findFirst({
            where: { device_key_id, user_id: principal.user_id },
            select: { revoked_at: true },
        });
        if (!row) {
            return reply.code(404).send({ error: 'delegation_not_found' });
        }
        if (row.revoked_at != null) {
            return reply.code(200).send({ device_key_id, revoked_at: row.revoked_at });
        }
        const now = Math.floor(Date.now() / 1000);
        const sessionMarker = canonicalJson({ source: 'session', revoked_at: now });
        const upd = await prisma.author_delegations.updateMany({
            where: {
                device_key_id,
                user_id: principal.user_id,
                revoked_at: null,
            },
            data: {
                revoked_at: now,
                revocation_json: sessionMarker,
            },
        });
        if (upd.count === 0) {
            const fresh = await prisma.author_delegations.findUnique({
                where: { device_key_id },
                select: { revoked_at: true },
            });
            return reply.code(200).send({ device_key_id, revoked_at: fresh?.revoked_at ?? now });
        }
        return reply.code(200).send({ device_key_id, revoked_at: now });
    });
    // --------------------------------------------------------------------------
    // GET /api/v1/authors/:handle/revoked-device-keys — public negative info for
    // subscribers. No auth; returns only revoked device_key_ids.
    // --------------------------------------------------------------------------
    app.get<{
        Params: {
            handle: string;
        };
    }>('/api/v1/authors/:handle/revoked-device-keys', async (req, reply) => {
        const handle = req.params.handle.replace(/^@/, '').toLowerCase();
        const user = await prisma.users.findFirst({
            where: { handle },
            select: { id: true },
        });
        if (!user) {
            return reply.code(200).send({ device_key_ids: [] });
        }
        const rows = await prisma.author_delegations.findMany({
            where: { user_id: user.id, revoked_at: { not: null } },
            select: { device_key_id: true },
        });
        return reply.code(200).send({
            device_key_ids: rows.map((r) => r.device_key_id),
        });
    });
}
