// PROTOCOL §3: resolve a Bearer token into a typed Principal and enforce
// the three token classes at the handler boundary. Read of public skills
// requires no token — handlers opt into auth via requireBearer / requireSession.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { DatabaseSync } from '../db/sqlite-handle.js'
import { classifyToken, DEVICE_TOKEN_TTL_SEC, hashToken, parseBearer, scopesFor, type TokenClass } from './tokens.js';
import { userHasVerifiedEmailPrisma } from './identities.js';
import { isAdminUserPrisma } from './admin.js';
import type { PrismaDb } from '../db/prisma-client.js';
import { asHandle, asUserId, type Handle, type UserId } from './identity.js';
import {
  normalizeClientKind,
  normalizeMachineId,
  parseStoredKinds,
  STALE_SIBLING_SEC,
} from './client-identity.js';

export type Principal =
  | {
      class: 'device';
      device_id: string;
      user_id: UserId | null;
      scopes: readonly string[];
    }
  | {
      class: 'session';
      session_id: string;
      user_id: UserId;
      handle: Handle | null;
      two_factor: boolean;
      scopes: readonly string[];
    }
  | {
      class: 'kit';
      kit_key_id: string;
      kit_id: string;
      scopes: readonly string[];
    }
  | {
      class: 'mcp';
      mcp_link_id: string;
      user_id: UserId;
      scopes: readonly string[];
    };

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
    /**
     * Set by the auth decorator when the request presented a well-formed
     * device-class token whose hash matches no devices row — a dangling
     * credential (deleted device, or a retired anonymous token). Lets 401
     * producers attach the pair-flow signpost without restructuring errors.
     */
    staleDeviceToken?: boolean;
  }

  interface FastifyInstance {
    /** True when auth resolution uses Prisma (see registerAuthDecorator opts). */
    skilletPrismaAuth?: boolean;
  }
}

/**
 * The one self-explanatory signpost for machines without a live account-bound
 * device credential. Old published clients (core bootstrap-device) render
 * exactly `body.message`, so this string is the whole UX for them: it must say
 * what happened and the two steps out (create an account, pair the machine).
 */
export function pairFlowGuidance(): string {
  const webUrl = (process.env.SKILLET_WEB_URL ?? 'https://skillet.md').replace(/\/+$/, '');
  return (
    'Anonymous devices are no longer supported. ' +
    `Create an account at ${webUrl}, then pair this machine with \`skillet connect <code>\`.`
  );
}

/**
 * Standard 401 body. When the caller held a dangling device token (see
 * `staleDeviceToken`), the body carries the pair-flow guidance — a bare
 * `auth_required` would strand old clients whose device rows were deleted.
 */
export function authRequiredBody(
  req: FastifyRequest,
): { error: 'auth_required'; message?: string } {
  return req.staleDeviceToken
    ? { error: 'auth_required', message: pairFlowGuidance() }
    : { error: 'auth_required' };
}

interface DeviceRow {
  id: string;
  user_id: string | null;
  machine_id: string | null;
  client_kinds: string | null;
}

/** Raw header values a client may send alongside its device token. */
export interface ClientIdentityHeaders {
  machineId?: unknown;
  clientKind?: unknown;
}


/** Prisma async counterpart of {@link applyClientIdentity} (U4 wave 1). */
async function applyClientIdentityPrisma(
  prisma: PrismaDb,
  row: DeviceRow,
  identity: ClientIdentityHeaders | undefined,
  now: number,
): Promise<void> {
  const machineId = normalizeMachineId(identity?.machineId);
  const clientKind = normalizeClientKind(identity?.clientKind);
  const kinds = parseStoredKinds(row.client_kinds);

  const machineChanged = machineId != null && machineId !== row.machine_id;
  const kindMissing = clientKind != null && !kinds.includes(clientKind);
  if (!machineChanged && !kindMissing) return;

  const mergedKinds = [...kinds];
  if (clientKind != null && !mergedKinds.includes(clientKind)) mergedKinds.push(clientKind);

  if (machineChanged && row.user_id != null) {
    const siblings = await prisma.devices.findMany({
      where: {
        user_id: row.user_id,
        machine_id: machineId,
        id: { not: row.id },
      },
      select: { id: true, client_kinds: true, last_seen_at: true, created_at: true },
    });
    for (const sibling of siblings) {
      const seen = sibling.last_seen_at ?? sibling.created_at;
      if (now - seen < STALE_SIBLING_SEC) continue;
      for (const kind of parseStoredKinds(sibling.client_kinds)) {
        if (!mergedKinds.includes(kind)) mergedKinds.push(kind);
      }
      await prisma.device_skill_materializations.deleteMany({
        where: { device_id: sibling.id },
      });
      await prisma.sessions.updateMany({
        where: { device_id: sibling.id, revoked_at: null },
        data: { revoked_at: now },
      });
      await prisma.devices.delete({ where: { id: sibling.id } });
    }
  }

  await prisma.devices.update({
    where: { id: row.id },
    data: {
      machine_id: machineId ?? row.machine_id,
      client_kinds: JSON.stringify(mergedKinds),
    },
  });
}

/** Prisma async counterpart of {@link resolvePrincipal} (U4 wave 1). */
export async function resolvePrincipalPrisma(
  prisma: PrismaDb,
  authHeader: string | undefined,
  identity?: ClientIdentityHeaders,
): Promise<Principal | null> {
  const token = parseBearer(authHeader);
  if (!token) return null;
  const cls = classifyToken(token);
  if (!cls) return null;
  const tokenHash = hashToken(token);
  const now = Math.floor(Date.now() / 1000);

  if (cls === 'device') {
    const row = await prisma.devices.findUnique({
      where: { token_hash: tokenHash },
      select: { id: true, user_id: true, machine_id: true, client_kinds: true, revoked_at: true, expires_at: true },
    });
    if (!row) return null;
    // Parity with sessions/kit_keys/mcp_links (#464): a revoked or idle-expired
    // device token no longer resolves. Null expires_at means "no expiry", so the
    // middleware deploy is safe before the backfill migration lands.
    if (row.revoked_at != null) return null;
    if (row.expires_at != null && row.expires_at < now) return null;
    // Slide the idle-expiry deadline forward on use, in the same write that
    // already stamps last_seen_at (no extra query). An actively-syncing device
    // never expires; a dormant leaked copy dies after the TTL window.
    await prisma.devices.update({
      where: { id: row.id },
      data: { last_seen_at: now, expires_at: now + DEVICE_TOKEN_TTL_SEC },
    });
    await applyClientIdentityPrisma(prisma, row, identity, now);
    return {
      class: 'device',
      device_id: row.id,
      user_id: asUserId(row.user_id),
      scopes: scopesFor('device'),
    };
  }

  if (cls === 'session') {
    const row = await prisma.sessions.findUnique({
      where: { token_hash: tokenHash },
      select: {
        id: true,
        user_id: true,
        expires_at: true,
        revoked_at: true,
        users: { select: { handle: true, two_factor: true } },
      },
    });
    if (!row) return null;
    if (row.revoked_at != null) return null;
    if (row.expires_at != null && row.expires_at < now) return null;
    return {
      class: 'session',
      session_id: row.id,
      user_id: asUserId(row.user_id),
      handle: row.users.handle == null ? null : asHandle(row.users.handle),
      two_factor: row.users.two_factor === 1,
      scopes: scopesFor('session'),
    };
  }

  if (cls === 'kit') {
    const row = await prisma.kit_keys.findUnique({
      where: { token_hash: tokenHash },
      select: { id: true, kit_id: true, expires_at: true, revoked_at: true },
    });
    if (!row) return null;
    if (row.revoked_at != null) return null;
    if (row.expires_at != null && row.expires_at < now) return null;
    return {
      class: 'kit',
      kit_key_id: row.id,
      kit_id: row.kit_id,
      scopes: scopesFor('kit'),
    };
  }

  const mcp = await prisma.mcp_links.findUnique({
    where: { token_hash: tokenHash },
    select: { id: true, user_id: true, revoked_at: true },
  });
  if (!mcp) return null;
  if (mcp.revoked_at != null) return null;
  await prisma.mcp_links.update({
    where: { id: mcp.id },
    data: { last_used_at: now },
  });
  return {
    class: 'mcp',
    mcp_link_id: mcp.id,
    user_id: asUserId(mcp.user_id),
    scopes: scopesFor('mcp'),
  };
}

/** Mounts a preHandler that attaches `req.principal` for ANY valid token.
 *  Routes still decide whether the principal is required or sufficient.
 *  Pass `prisma` only when that client is the live session store (U2 flip);
 *  decorating skilletPrisma alone must not divert auth while sqlite still writes. */
export function registerAuthDecorator(
  app: FastifyInstance,
  db: DatabaseSync,
  opts?: { prisma?: PrismaDb },
): void {
  const prisma = opts?.prisma;
  if (prisma) {
    app.decorate('skilletPrismaAuth', true);
  }
  app.addHook('preHandler', async (req: FastifyRequest) => {
    const identity = {
      machineId: req.headers['x-skillet-machine-id'],
      clientKind: req.headers['x-skillet-client-kind'],
    };
    if (!prisma) {
      throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
    }
    const principal = await resolvePrincipalPrisma(prisma, req.headers.authorization, identity);
    if (principal) {
      req.principal = principal;
      return;
    }
    // A device-class token that resolved to nothing can only mean the devices
    // row is gone (device-token resolution has no expiry/revocation branch).
    // Flag it so the eventual 401 carries the pair-flow signpost.
    const token = parseBearer(req.headers.authorization);
    if (token && classifyToken(token) === 'device') req.staleDeviceToken = true;
  });
}

/** Generic guard: requires a valid token of a specific class. */
export function requireClass(cls: TokenClass) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.principal) {
      await reply.code(401).send(authRequiredBody(req));
      return;
    }
    if (req.principal.class !== cls) {
      await reply.code(403).send({
        error: 'wrong_token_class',
        required: cls,
        got: req.principal.class,
      });
      return;
    }
  };
}

/** Requires a user session (publish/claim per PROTOCOL §3). */
export const requireSession = requireClass('session');

/**
 * Requires any token that identifies an *account* — a web session OR a device
 * token bound to a user. This is the keystone of symmetric join: any
 * surface that has already joined an account (browser via session, CLI/desktop
 * via device token) can mint a join code to attach the next surface.
 *
 * A device principal with a null user_id is rejected as a defensive invariant:
 * devices are always account-bound (the schema enforces devices.user_id NOT
 * NULL once the U6 migration lands), so this branch only guards out-of-band
 * rows — it is not a supported state.
 */
/**
 * Who may act on a device row: the account that owns it (session), or the
 * device itself (its own token). Shared by rename (PATCH /devices/:id),
 * remove (DELETE /devices/:id), and the device-agents/materializations
 * reports, so the ownership rule cannot drift between routes. Callers reach
 * this only behind requireUser, so a device principal has already resolved to
 * an account; the row check stops a device acting on a sibling row, and the
 * row.user_id guard keeps out-of-band unowned rows unreachable.
 */
export function canActOnDevice(
  principal: Principal,
  row: { user_id: string | null },
  deviceId: string,
): boolean {
  if (principal.class === 'session') return row.user_id === principal.user_id;
  if (principal.class === 'device') return principal.device_id === deviceId && row.user_id != null;
  return false;
}

export function requireUser() {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const p = req.principal;
    if (!p) {
      await reply.code(401).send(authRequiredBody(req));
      return;
    }
    if (p.class === 'session') return;
    if (p.class === 'device' && p.user_id) return;
    await reply.code(403).send({
      error: 'user_token_required',
      message: 'This action needs an account-bound session or device token.',
      got: p.class,
    });
  };
}

/**
 * Requires a platform admin: an account-bound principal (web session or a
 * device token tied to a user) whose account is flagged `is_admin` or named in
 * `SKILLET_ADMIN_HANDLES`. Accepting device tokens lets an admin run this from
 * the terminal with their CLI credential. For site-wide moderation and
 * brand-handle handoff — not org-scoped actions (those use org roles).
 */
export function requireAdmin() {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const p = req.principal;
    if (!p) {
      await reply.code(401).send(authRequiredBody(req));
      return;
    }
    const userId = p.class === 'session' ? p.user_id : p.class === 'device' ? p.user_id : null;
    if (!userId) {
      await reply.code(403).send({
        error: 'user_token_required',
        message: 'This action needs an account-bound session or device token.',
        got: p.class,
      });
      return;
    }
    const prismaAdmin = req.server.skilletPrismaAuth ? req.server.skilletPrisma : undefined;
    if (!prismaAdmin) {
      throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
    }
    const isAdmin = await isAdminUserPrisma(prismaAdmin, userId);
    if (!isAdmin) {
      await reply.code(403).send({ error: 'admin_required' });
      return;
    }
  };
}

/** Inline guard for handlers that cannot use route preHandler. Returns null after sending 401/403. */
export async function ensureSessionPrincipal(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<Extract<Principal, { class: 'session' }> | null> {
  await requireSession(req, reply);
  if (reply.sent) return null;
  return req.principal as Extract<Principal, { class: 'session' }>;
}

/**
 * Any `requireSession` route that exercises `publish` or `claim`
 * scope must additionally belong to a user with at least one IdP-verified
 * email (see {@link userHasVerifiedEmail}). Read/sync paths stay open.
 */
export function requireScope(scope: 'publish' | 'claim') {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!req.principal) {
      await reply.code(401).send(authRequiredBody(req));
      return;
    }
    if (req.principal.class !== 'session') {
      await reply.code(403).send({
        error: 'wrong_token_class',
        required: 'session',
        got: req.principal.class,
      });
      return;
    }
    const prismaScope = req.server.skilletPrismaAuth ? req.server.skilletPrisma : undefined;
    if (!prismaScope) {
      throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
    }
    const verified = await userHasVerifiedEmailPrisma(prismaScope, req.principal.user_id);
    if (!verified) {
      await reply.code(403).send({
        error: 'account_verification_required',
        scope,
        message:
          'Publishing and claiming require a verified account. Verify your email with your sign-in provider and try again.',
      });
      return;
    }
  };
}
