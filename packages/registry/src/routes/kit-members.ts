// PROTOCOL §8.1 / §8.2 — kit members + invites + agent kit-keys.
//
// Three surfaces, all owner-gated by session:
//   POST   /api/v1/kits/:kitId/members  invite a human or mint an agent key
//   DELETE /api/v1/kits/:kitId/members  revoke a human row or an agent key
//   GET    /api/v1/kits/:kitId/members  list humans/pending/agents (no secrets)
//
// Token secrets are returned exactly once at mint. The list
// surface NEVER returns a raw secret — only the kit_key_id + label + lifecycle
// timestamps. Revocation is uncached: the next `whoami` against a revoked key
// fails inside the same request loop.
import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from '../db/sqlite-handle.js'
import type { PrismaClient } from '@prisma/client';
import { mintToken } from '../auth/tokens.js';
import { requireSession } from '../auth/middleware.js';
import {
  canManageKitPrisma,
  canViewKitMembersPrisma,
} from '../lib/org-access.js';
import { newId } from '../db/index.js';

interface KitParams {
  kitId: string;
}

interface SessionPrincipal {
  user_id: string;
  handle: string | null;
}

interface InviteBody {
  kind?: 'human' | 'agent';
  email?: string;
  handle?: string;
  label?: string;
  expires_at?: number;
}

interface RevokeBody {
  member_id?: string;
}

const LABEL_MAX = 80;

/**
 * Email-bind hook: when a user binds an email (OAuth attach), invites pinned to
 * that address must promote into kit_members + flip redeemed_at, same as the
 * /claim handle path. Lives here so the OAuth attach path can import a stable
 * name without having to know the schema; the runtime is a no-op until /claim
 * or OAuth passes a real (userId, email) pair.
 *
 * Future: wire this from the OAuth attach handler once users.email lands.
 *
 * Defense-in-depth: an email only acts as an authorization fact when
 * the user actually holds an IdP-verified identity for it. Even if a caller
 * passes a `userId`/`email` pair where the address was never verified (a future
 * regression, or a non-BFF writer mistakenly trusted), we redeem nothing.
 */
export function resolvePendingByEmail(
  _db: DatabaseSync,
  _userId: string,
  _email: string,
): number {
  throw new Error('sqlite registry store removed; use the *Prisma counterpart: resolvePendingByEmail')
}

/** Used by /claim — keep idempotency with kit_members PK so a double-claim is harmless. */
export function resolvePendingByHandle(
  _db: DatabaseSync,
  _userId: string,
  _handle: string,
): number {
  throw new Error('sqlite registry store removed; use the *Prisma counterpart: resolvePendingByHandlePrisma')
}

/** Prisma async counterpart of {@link resolvePendingByHandle}. */
export async function resolvePendingByHandlePrisma(
  prisma: import('../db/prisma-client.js').PrismaDb,
  userId: string,
  handle: string,
): Promise<number> {
  if (!handle) return 0;
  const now = Math.floor(Date.now() / 1000);
  const invites = await prisma.kit_invites.findMany({
    where: {
      kind: 'human',
      handle,
      redeemed_at: null,
      OR: [{ expires_at: null }, { expires_at: { gte: now } }],
    },
    select: { id: true, kit_id: true, invited_by: true },
  });
  let count = 0;
  for (const inv of invites) {
    if (!inv.kit_id) continue;
    await prisma.kit_members.createMany({
      data: [
        {
          kit_id: inv.kit_id,
          user_id: userId,
          invited_by: inv.invited_by,
          invited_at: now,
          accepted_at: now,
        },
      ],
      skipDuplicates: true,
    });
    await prisma.kit_invites.update({
      where: { id: inv.id },
      data: { redeemed_at: now },
    });
    count++;
  }
  return count;
}


function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerKitMemberRoutes(
  app: FastifyInstance,
  prismaArg?: PrismaClient,
): void {
  const prisma = requirePrisma(
    prismaArg ??
      (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
  )

  // POST /api/v1/kits/:kitId/members
  // Owner-only. Adds a human member (or pending invite), or mints an agent kit-key.
  app.post<{ Params: KitParams; Body: InviteBody }>(
    '/api/v1/kits/:kitId/members',
    { preHandler: requireSession },
    async (req, reply) => {
      const principal = req.principal as SessionPrincipal;
      const { kitId } = req.params;
      const body = req.body ?? {};

      
        const kitRow = await prisma.kits.findUnique({
          where: { id: kitId },
          select: { owner_id: true },
        });
        if (!kitRow) return reply.code(404).send({ error: 'kit_not_found' });
        if (!(await canManageKitPrisma(prisma, kitRow.owner_id, principal))) {
          return reply.code(403).send({ error: 'not_owner' });
        }

        const kind = body.kind;
        if (kind !== 'human' && kind !== 'agent') {
          return reply.code(400).send({ error: 'invalid_kind' });
        }
        if (
          body.expires_at != null &&
          (typeof body.expires_at !== 'number' || !Number.isFinite(body.expires_at) || body.expires_at <= 0)
        ) {
          return reply.code(400).send({ error: 'invalid_expires_at' });
        }

        if (kind === 'human') {
          const hasEmail = typeof body.email === 'string' && body.email.length > 0;
          const hasHandle = typeof body.handle === 'string' && body.handle.length > 0;
          if (hasEmail === hasHandle) {
            return reply.code(400).send({ error: 'missing_identifier' });
          }

          if (hasHandle) {
            const user = await prisma.users.findFirst({
              where: { handle: body.handle! },
              select: { id: true, handle: true },
            });
            if (user) {
              const already = await prisma.kit_members.findUnique({
                where: { kit_id_user_id: { kit_id: kitId, user_id: user.id } },
                select: { kit_id: true },
              });
              if (already) return reply.code(409).send({ error: 'already_member' });
              const now = Math.floor(Date.now() / 1000);
              await prisma.kit_members.create({
                data: {
                  kit_id: kitId,
                  user_id: user.id,
                  invited_by: principal.user_id,
                  invited_at: now,
                  accepted_at: now,
                },
              });
              return reply.code(200).send({ status: 'added', member_id: user.id });
            }
          }

          const dupe = await prisma.kit_invites.findFirst({
            where: {
              kit_id: kitId,
              kind: 'human',
              redeemed_at: null,
              OR: [
                ...(body.handle ? [{ handle: body.handle }] : []),
                ...(body.email ? [{ email: body.email }] : []),
              ],
            },
            select: { id: true },
          });
          if (dupe) return reply.code(409).send({ error: 'already_invited' });

          const inviteId = newId();
          await prisma.kit_invites.create({
            data: {
              id: inviteId,
              kit_id: kitId,
              kind: 'human',
              email: hasEmail ? body.email! : null,
              handle: hasHandle ? body.handle! : null,
              invited_by: principal.user_id,
              expires_at: body.expires_at ?? null,
            },
          });
          return reply.code(200).send({ status: 'invited', member_id: inviteId });
        }

        const label = typeof body.label === 'string' ? body.label.trim() : '';
        if (!label || label.length > LABEL_MAX) {
          return reply.code(400).send({ error: 'label_required' });
        }

        const kitKeyId = newId();
        const { secret, hash } = mintToken('kit');
        await prisma.kit_keys.create({
          data: {
            id: kitKeyId,
            kit_id: kitId,
            token_hash: hash,
            label,
            created_by: principal.user_id,
            expires_at: body.expires_at ?? null,
          },
        });
        const inviteId = newId();
        const now = Math.floor(Date.now() / 1000);
        await prisma.kit_invites.create({
          data: {
            id: inviteId,
            kit_id: kitId,
            kind: 'agent',
            label,
            invited_by: principal.user_id,
            expires_at: body.expires_at ?? null,
            kit_key_id: kitKeyId,
            redeemed_at: now,
          },
        });
        return reply.code(201).send({ kit_key_id: kitKeyId, kit_token: secret, label });

    },
  );

  // DELETE /api/v1/kits/:kitId/members
  // Owner-only. `member_id` is either a users.id (human) or a kit_keys.id (agent).
  app.delete<{ Params: KitParams; Body: RevokeBody }>(
    '/api/v1/kits/:kitId/members',
    { preHandler: requireSession },
    async (req, reply) => {
      const principal = req.principal as SessionPrincipal;
      const { kitId } = req.params;
      const memberId = req.body?.member_id;
      if (!memberId || typeof memberId !== 'string') {
        return reply.code(400).send({ error: 'member_id_required' });
      }

      
        const kitRow = await prisma.kits.findUnique({
          where: { id: kitId },
          select: { owner_id: true },
        });
        if (!kitRow) return reply.code(404).send({ error: 'kit_not_found' });
        if (!(await canManageKitPrisma(prisma, kitRow.owner_id, principal))) {
          return reply.code(403).send({ error: 'not_owner' });
        }

        const human = await prisma.kit_members.deleteMany({
          where: { kit_id: kitId, user_id: memberId },
        });
        if (human.count > 0) {
          return reply.code(200).send({ status: 'revoked' });
        }

        const now = Math.floor(Date.now() / 1000);
        const agent = await prisma.kit_keys.updateMany({
          where: { id: memberId, kit_id: kitId, revoked_at: null },
          data: { revoked_at: now },
        });
        if (agent.count > 0) {
          return reply.code(200).send({ status: 'revoked' });
        }

        const pending = await prisma.kit_invites.deleteMany({
          where: {
            id: memberId,
            kit_id: kitId,
            kind: 'human',
            redeemed_at: null,
          },
        });
        if (pending.count > 0) {
          return reply.code(200).send({ status: 'revoked' });
        }

        return reply.code(404).send({ error: 'member_not_found' });

    },
  );

  // GET /api/v1/kits/:kitId/members
  // Owner OR member of kit. Never returns token secrets.
  app.get<{ Params: KitParams }>(
    '/api/v1/kits/:kitId/members',
    { preHandler: requireSession },
    async (req, reply) => {
      const principal = req.principal as SessionPrincipal;
      const { kitId } = req.params;

      
        const kitRow = await prisma.kits.findUnique({
          where: { id: kitId },
          select: { owner_id: true },
        });
        if (!kitRow) return reply.code(404).send({ error: 'kit_not_found' });

        if (!(await canViewKitMembersPrisma(prisma, kitId, kitRow.owner_id, principal))) {
          return reply.code(403).send({ error: 'not_authorized' });
        }

        const humans = await prisma.kit_members.findMany({
          where: { kit_id: kitId },
          orderBy: { invited_at: 'asc' },
          select: {
            user_id: true,
            invited_at: true,
            accepted_at: true,
            users_kit_members_user_idTousers: { select: { handle: true } },
          },
        });

        const pending = await prisma.kit_invites.findMany({
          where: { kit_id: kitId, kind: 'human', redeemed_at: null },
          orderBy: { created_at: 'asc' },
          select: { id: true, email: true, handle: true, created_at: true },
        });

        const agents = await prisma.kit_keys.findMany({
          where: { kit_id: kitId },
          orderBy: { created_at: 'asc' },
          select: {
            id: true,
            label: true,
            created_at: true,
            expires_at: true,
            revoked_at: true,
          },
        });

        return reply.send({
          owner: kitRow.owner_id,
          humans: humans.map((h) => ({
            user_id: h.user_id,
            handle: h.users_kit_members_user_idTousers.handle,
            invited_at: h.invited_at,
            accepted_at: h.accepted_at,
          })),
          pending_humans: pending.map((p) => ({
            invite_id: p.id,
            email: p.email,
            handle: p.handle,
            invited_at: p.created_at,
          })),
          agents: agents.map((a) => ({
            kit_key_id: a.id,
            label: a.label,
            created_at: a.created_at,
            expires_at: a.expires_at,
            revoked_at: a.revoked_at,
          })),
        });

    },
  );
}

