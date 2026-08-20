// PROTOCOL §3 / §5 — identity & auth surface.
//
// Mounted under /api/v1/ (normative; existing routes still live under /v1/
// pending the prefix migration).
//
// Endpoints:
//   POST /api/v1/signup                  → 410 Gone (anonymous devices retired; pair via connect)
//   POST /api/v1/devices/token           → session-minted device token (Connect wizard)
//   POST /api/v1/connect/codes             → session-minted pair code (web → CLI attach)
//   POST /api/v1/connect/claim             → redeem pair code → session + device tokens
//   POST /api/v1/claim                   → register {handle, public_key}; 409 name_taken
//   GET  /api/v1/whoami                  → {handle?, device_id?, user_id, scopes}
//     (devices are always account-bound; a device whoami never reports a null
//      user_id — dangling device tokens fail auth before reaching whoami)
//   GET  /api/v1/auth/session/pickup     → CLI exchanges pickup_id → session_token (one-time)
//     (the pickup row is parked by the magic-link verify flow, gated on a CLI user code)
//   POST /api/v1/auth/logout             → revokes the calling session
//   POST /api/v1/sessions/dev            → DEV-ONLY session minter (NODE_ENV !== 'production')

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DEVICE_TOKEN_TTL_SEC, mintToken, scopesFor } from '../auth/tokens.js';
import {
  canActOnDevice,
  requireSession,
  requireUser,
  requireScope,
  pairFlowGuidance,
  authRequiredBody,
} from '../auth/middleware.js';
import type { Principal } from '../auth/middleware.js';
import { newId } from '../db/index.js';
import {
  upsertIdentityUserPrisma,
  userIdByVerifiedEmailPrisma,
  applyIdpProfileToAuthorPrisma,
  identityProfileHintsPrisma,
  userPrimaryEmailPrisma,
  userLinkedProvidersPrisma,
  userHasGithubIdentityPrisma,
  userHasVerifiedEmailMatchPrisma,
} from '../auth/identities.js';
import { mintSessionForUserPrisma } from '../auth/web-routes.js';
import { resolvePendingByHandlePrisma } from './kit-members.js';
import {
  handleOrSlugTakenPrisma,
  getOrgBySlugPrisma,
} from '../lib/org-access.js';
import type { PrismaClient } from '@prisma/client';
import { runPrismaTransaction } from '../db/prisma-client.js';
import { verifyWebInternalSignature } from '../auth/web-internal-sig.js';
import {
  grantBrandOrgPrisma,
  parseMirrorOwnerLogin,
  claimMirrorAsUserPrisma,
  BrandGrantError,
} from '../lib/brand-grant.js';
import { parseStoredAgents } from './device-agents.js';
import { parseStoredKinds } from '../auth/client-identity.js';
import { isReservedHandle } from '@skillet/protocol';
import { parseBrandClaimAllowlist } from '../auth/brand-claim.js';

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
  }
  return prisma;
}

interface DevicesTokenBody {
  label?: string;
}

interface ClaimBody {
  handle?: string;
  public_key?: string;
  key_id?: string;
}

interface DevSessionBody {
  handle?: string;
  two_factor?: boolean;
}

/**
 * Body for POST /api/v1/auth/web/claim-github — the BFF-attested, HMAC-gated
 * server->server GitHub claim. `github_login` + numeric `github_id` are the
 * VERIFIED eligibility result; `user_id` is the claimant's user id (sourced from
 * their verified session). `end_state` is now ADVISORY only — a logged-in claim
 * of ANY mirror (Org- or User-source) makes the claimant the OWNER of that
 * namespace as an org, so this handler always grants an org. The field is still
 * accepted for wire compatibility but is not branched on.
 */
interface ClaimGithubBody {
  handle?: string;
  github_login?: string;
  github_id?: number;
  end_state?: 'org' | 'user';
  user_id?: string;
}

/**
 * In-memory rate limiter config for the GitHub claim endpoint. Keyed on
 * handle/user_id (NOT client IP — every call shares the BFF egress IP, so an IP
 * key is meaningless). Count-all-attempts + a global cap, mirroring
 * ratelimit/pair-claim.ts. Env-overridable so the window can be tightened in
 * prod (and shrunk in tests) without a deploy.
 */
interface ClaimGithubLimitConfig {
  perMinute: number;
  perHour: number;
  globalPerMinute: number;
}

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function loadClaimGithubLimitConfig(): ClaimGithubLimitConfig {
  return {
    perMinute: readPositiveInt('SKILLET_CLAIM_GITHUB_RATE_PER_MINUTE', 10),
    perHour: readPositiveInt('SKILLET_CLAIM_GITHUB_RATE_PER_HOUR', 60),
    globalPerMinute: readPositiveInt('SKILLET_CLAIM_GITHUB_GLOBAL_PER_MINUTE', 300),
  };
}

/**
 * Body for POST /api/v1/auth/web/claim-github-bootstrap — the logged-OUT
 * account-bootstrap GitHub claim. A person with NO Skillet account proves (via the
 * BFF's read:org + user:email verification) they own the personal GitHub repo a
 * mirror tracks; the registry mints them a fresh account whose handle == the mirror
 * handle. `github_login` + numeric `github_id` are the VERIFIED eligibility result;
 * `verified_email` is their GitHub primary verified email (the new account must be
 * able to pass the verified-email publish/claim gate). This is the ONLY path that
 * creates an account from a GitHub claim — and only for a User-source mirror, under
 * the strict gates in the handler.
 */
interface ClaimGithubBootstrapBody {
  handle?: string;
  github_login?: string;
  github_id?: number;
  verified_email?: string;
}

/**
 * Rate-limit config for the account-bootstrap endpoint. UNLIKE claim-github (keyed
 * on user_id, which a logged-out caller doesn't have), this surface is keyed on the
 * REQUEST IP plus a global cap — it is an unauthenticated account-minting surface,
 * so every attempt (incl. misses) is counted. Env-overridable.
 */
function loadBootstrapLimitConfig(): ClaimGithubLimitConfig {
  return {
    perMinute: readPositiveInt('SKILLET_CLAIM_BOOTSTRAP_RATE_PER_MINUTE', 5),
    perHour: readPositiveInt('SKILLET_CLAIM_BOOTSTRAP_RATE_PER_HOUR', 20),
    globalPerMinute: readPositiveInt('SKILLET_CLAIM_BOOTSTRAP_GLOBAL_PER_MINUTE', 60),
  };
}

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,38}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Acceptance §4: session TTL. 14d default. Configurable via env so a smaller
// value can be wired in for tests without monkeypatching time.
const DEFAULT_SESSION_TTL_SEC = 14 * 86400;
function sessionTtlSec(): number {
  const raw = process.env.SKILLET_SESSION_TTL_SEC;
  if (!raw) return DEFAULT_SESSION_TTL_SEC;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_SESSION_TTL_SEC;
}

export interface AuthRouteOptions {
  /**
   * Enables the DEV-ONLY `/sessions/dev` minter. Fail-CLOSED: false unless an
   * explicit impossible-in-prod signal is set (an in-memory DB, or
   * SKILLET_ENABLE_DEV_AUTH=1). Never gate this on the mere absence of
   * NODE_ENV==='production'.
   */
  devAuth?: boolean;
  /**
   * When set, session mint (and matching identity writes on the live auth path)
   * go to MySQL via Prisma. Pair with registerAuthDecorator(..., { prisma }).
   */
  prisma?: PrismaClient;
}

export function postLoginRedirect(returnTo?: string | null): string {
  const webUrl = process.env.SKILLET_WEB_URL;
  const fallback = webUrl ? `${webUrl}/auth/done` : '/auth/done';
  // Only redirect to the configured web origin — exact origin match via the URL
  // parser, never a `startsWith`/regex. Any off-origin or malformed target falls
  // back to the safe default (no open redirect).
  if (returnTo && webUrl) {
    try {
      if (new URL(returnTo).origin === new URL(webUrl).origin) return returnTo;
    } catch {
      /* malformed returnTo → fallback */
    }
  }
  return fallback;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  _db: unknown,
  opts: AuthRouteOptions = {},
): void {
  const devAuth = opts.devAuth === true;
  const prisma = opts.prisma;

  // The trusted web BFF proves itself by HMAC-signing the request (same model as
  // auth/web-routes.ts). A raw session holder replaying their cookie cannot reach
  // this write path because each call must be freshly signed.
  const webInternalAuthorized = (req: FastifyRequest): boolean =>
    verifyWebInternalSignature({
      method: req.method,
      url: req.url,
      body: req.body ?? {},
      headers: req.headers,
      devAuth,
    });

  // In-memory claim-abuse limiter, scoped to THIS server instance (a closure, not
  // module state) so test servers and horizontally-scaled processes don't share a
  // window. Records EVERY attempt (incl. misses) before enforcing so a guesser
  // can't reset the window. Keyed on `${user_id}:${handle}` — never client IP.
  const claimGithubAttempts: Array<{ key: string; at: number }> = [];
  function claimGithubRateLimited(
    key: string,
  ): { scope: 'global' | 'minute' | 'hour'; retryAfter: number } | null {
    const cfg = loadClaimGithubLimitConfig();
    const now = Math.floor(Date.now() / 1000);
    const hourAgo = now - 3600;
    const minuteAgo = now - 60;

    // Opportunistic prune of rows older than the widest window.
    for (let i = claimGithubAttempts.length - 1; i >= 0; i--) {
      if (claimGithubAttempts[i].at < hourAgo) claimGithubAttempts.splice(i, 1);
    }

    // Pre-insert counts (count of PRIOR attempts), so each window lets exactly
    // `cap` requests through before blocking.
    let keyMinute = 0;
    let keyHour = 0;
    let globalMinute = 0;
    for (const a of claimGithubAttempts) {
      if (a.at >= minuteAgo) {
        globalMinute++;
        if (a.key === key) keyMinute++;
      }
      if (a.key === key && a.at >= hourAgo) keyHour++;
    }

    // Record before enforcing so the window advances even on rejected requests.
    claimGithubAttempts.push({ key, at: now });

    if (globalMinute >= cfg.globalPerMinute) return { scope: 'global', retryAfter: 60 };
    if (keyMinute >= cfg.perMinute) return { scope: 'minute', retryAfter: 60 };
    if (keyHour >= cfg.perHour) return { scope: 'hour', retryAfter: 3600 };
    return null;
  }

  // Separate in-memory limiter for the unauthenticated account-bootstrap surface,
  // keyed on the REQUEST IP (a logged-out caller has no user_id) plus a global cap.
  // Same record-before-enforce shape so a miss still advances the window.
  const bootstrapAttempts: Array<{ key: string; at: number }> = [];
  function bootstrapRateLimited(
    key: string,
  ): { scope: 'global' | 'minute' | 'hour'; retryAfter: number } | null {
    const cfg = loadBootstrapLimitConfig();
    const now = Math.floor(Date.now() / 1000);
    const hourAgo = now - 3600;
    const minuteAgo = now - 60;

    for (let i = bootstrapAttempts.length - 1; i >= 0; i--) {
      if (bootstrapAttempts[i].at < hourAgo) bootstrapAttempts.splice(i, 1);
    }

    let keyMinute = 0;
    let keyHour = 0;
    let globalMinute = 0;
    for (const a of bootstrapAttempts) {
      if (a.at >= minuteAgo) {
        globalMinute++;
        if (a.key === key) keyMinute++;
      }
      if (a.key === key && a.at >= hourAgo) keyHour++;
    }

    bootstrapAttempts.push({ key, at: now });

    if (globalMinute >= cfg.globalPerMinute) return { scope: 'global', retryAfter: 60 };
    if (keyMinute >= cfg.perMinute) return { scope: 'minute', retryAfter: 60 };
    if (keyHour >= cfg.perHour) return { scope: 'hour', retryAfter: 3600 };
    return null;
  }

  // PROTOCOL §5 (retired): anonymous device identity is gone — every device is
  // account-bound via the pair flow. Released clients (core bootstrap-device in
  // published npm versions) still POST here on first sync and render exactly
  // `body.message`, so this tombstone is permanent and the message is their
  // entire signpost. 410, never 404: the route intentionally ceased to exist.
  app.post('/api/v1/signup', async (_req, reply) => {
    return reply.code(410).send({
      error: 'anonymous_signup_retired',
      message: pairFlowGuidance(),
    });
  });

  // PROTOCOL §5: web-minted device token for the Connect-agent wizard.
  // Requires a user session — the wizard takes a logged-in user and stamps
  // a device token they can paste into a CI/agent env.
  app.post<{ Body: DevicesTokenBody }>(
    '/api/v1/devices/token',
    { preHandler: requireSession },
    async (req, reply) => {
      const userId = (req.principal as { user_id: string }).user_id;
      const id = newId();
      const { secret, hash } = mintToken('device');
      const label = (req.body?.label ?? 'connect-wizard').slice(0, 80);
      const db = requirePrisma(prisma);
      const now = Math.floor(Date.now() / 1000);
      await db.devices.create({
        data: { id, token_hash: hash, user_id: userId, label, expires_at: now + DEVICE_TOKEN_TTL_SEC },
      });
      return reply.code(201).send({ device_id: id, device_token: secret });
    },
  );

  // List the machines on the caller's account. Accepts a session OR an
  // account-bound device token (requireUser), so `skillet device` keeps
  // working when the web session lapses — the device token is the durable
  // machine credential, same policy as rename/remove below. requireUser
  // guarantees user_id is set for both principal classes.
  app.get('/api/v1/devices', { preHandler: requireUser() }, async (req, reply) => {
    const userId = (req.principal as { user_id: string }).user_id;
    const db = requirePrisma(prisma);
    const rows = await db.devices.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        label: true,
        created_at: true,
        detected_agents: true,
        agents_reported_at: true,
        last_seen_at: true,
        client_kind: true,
        client_kinds: true,
        client_platform: true,
        machine_id: true,
      },
    });
    return reply.send({
      devices: rows.map((r) => ({
        device_id: r.id,
        label: r.label,
        created_at: r.created_at,
        agents: parseStoredAgents(r.detected_agents),
        agents_reported_at: r.agents_reported_at,
        last_seen_at: r.last_seen_at,
        client_kind: r.client_kind,
        // Every kind that has ever connected for this machine (additive, R4).
        client_kinds: parseStoredKinds(r.client_kinds),
        client_platform: r.client_platform,
        machine_id: r.machine_id,
      })),
    });
  });

  // Rename a bearer device (sync agent) label. Accepts a session (rename any
  // owned machine from web Settings) OR the device's OWN token (self-rename
  // from the tray/CLI) — device tokens are the durable machine credential
  // while sessions lapse, same policy as the DELETE route below. Ownership
  // failures return 404 (no existence leak). The write touches ONLY the label
  // column: client_kind/platform/last_seen_at are the disambiguating signals a
  // stolen token must not be able to forge away (see rename-to-impersonate in
  // the device-rename plan), and labels are printed raw into terminals by
  // `skillet device list`, so control characters are stripped before storing.
  app.patch<{ Params: { device_id: string }; Body: { label?: string } }>(
    '/api/v1/devices/:device_id',
    { preHandler: requireUser() },
    async (req, reply) => {
      const principal = req.principal as Principal;
      const { device_id } = req.params;
      const { label } = req.body ?? {};

      if (typeof label !== 'string') {
        return reply.code(400).send({ error: 'label_required', message: 'label must be a string' });
      }

      const stripped = label.replace(/[\x00-\x1f\x7f]/g, '').trim();
      const cleanLabel = stripped.length > 0 ? stripped.slice(0, 80) : null;

      const db = requirePrisma(prisma);
      const row = await db.devices.findUnique({
        where: { id: device_id },
        select: { id: true, user_id: true },
      });
      if (!row || !canActOnDevice(principal, row, device_id)) {
        return reply.code(404).send({ error: 'device_not_found' });
      }
      await db.devices.update({
        where: { id: device_id },
        data: { label: cleanLabel },
      });
      return reply.send({ device_id, label: cleanLabel });
    },
  );

  // Disconnect a sync machine from the account. Removes materialization rows;
  // device_kit_excludes CASCADE with the devices row. Also revokes the
  // session(s) the device's pair claim minted, so "remove this machine" kills
  // its publish/upload — not just sync.
  //
  // Accepts a session token (remove any owned machine from web Settings) OR the
  // device's OWN token (self-unregister at sign-out). Device tokens never
  // expire while sessions lapse after the TTL, so keying self-unregister on the
  // device token keeps sign-out honest for long-lived machines — otherwise they
  // orphan a "connected" row they can no longer reach. Ownership failures
  // return 404 (no existence leak), matching the rename route above.
  app.delete<{ Params: { device_id: string } }>(
    '/api/v1/devices/:device_id',
    { preHandler: requireUser() },
    async (req, reply) => {
      const principal = req.principal as Principal;
      const { device_id } = req.params;

      const db = requirePrisma(prisma);
      const row = await db.devices.findUnique({
        where: { id: device_id },
        select: { id: true, user_id: true },
      });
      if (!row || !canActOnDevice(principal, row, device_id)) {
        return reply.code(404).send({ error: 'device_not_found' });
      }
      const now = Math.floor(Date.now() / 1000);
      await runPrismaTransaction(db, async (tx) => {
        await tx.device_skill_materializations.deleteMany({ where: { device_id } });
        await tx.sessions.updateMany({
          where: { device_id, revoked_at: null },
          data: { revoked_at: now },
        });
        // device_kit_excludes CASCADE with the devices row.
        await tx.devices.delete({ where: { id: device_id } });
      });
      return reply.code(204).send();
    },
  );

  // Soft-revoke a device without deleting its row (#464). Unlike DELETE, this
  // preserves the row + machine_id so re-pairing the same machine reclaims it
  // (revoked_at cleared, expiry refreshed). `auth logout` uses this to end the
  // current machine's access. Ownership failures return 404 (no existence leak),
  // matching DELETE.
  app.post<{ Params: { device_id: string } }>(
    '/api/v1/devices/:device_id/revoke',
    { preHandler: requireUser() },
    async (req, reply) => {
      const principal = req.principal as Principal;
      const { device_id } = req.params;

      const db = requirePrisma(prisma);
      const row = await db.devices.findUnique({
        where: { id: device_id },
        select: { id: true, user_id: true },
      });
      if (!row || !canActOnDevice(principal, row, device_id)) {
        return reply.code(404).send({ error: 'device_not_found' });
      }
      const now = Math.floor(Date.now() / 1000);
      await runPrismaTransaction(db, async (tx) => {
        await tx.sessions.updateMany({
          where: { device_id, revoked_at: null },
          data: { revoked_at: now },
        });
        await tx.devices.update({
          where: { id: device_id },
          data: { revoked_at: now },
        });
      });
      return reply.code(204).send();
    },
  );

  // Per-machine kit routing (settings → Connected devices). Stored as
  // exclusions: a device with no rows syncs the full account union, so the
  // default is "everything" with no backfill. See migration 015 + sync.ts.
  app.get<{ Params: { device_id: string } }>(
    '/api/v1/devices/:device_id/sync',
    { preHandler: requireSession },
    async (req, reply) => {
      const userId = (req.principal as { user_id: string }).user_id;
      const { device_id } = req.params;
      const db = requirePrisma(prisma);
      const owns = await db.devices.findFirst({
        where: { id: device_id, user_id: userId },
        select: { id: true },
      });
      if (!owns) return reply.code(404).send({ error: 'device_not_found' });
      const rows = await db.device_kit_excludes.findMany({
        where: { device_id },
        select: { source_key: true },
      });
      return reply.send({ excluded: rows.map((r) => r.source_key) });
    },
  );

  // Replace a device's excluded-kit set wholesale (the UI holds the full set).
  app.put<{ Params: { device_id: string }; Body: { excluded?: unknown } }>(
    '/api/v1/devices/:device_id/sync',
    { preHandler: requireSession },
    async (req, reply) => {
      const userId = (req.principal as { user_id: string }).user_id;
      const { device_id } = req.params;

      const raw = req.body?.excluded;
      if (!Array.isArray(raw)) {
        return reply.code(400).send({ error: 'excluded_required', message: 'excluded must be an array' });
      }
      // Only canonical manifest group keys are storable — `author:self`,
      // `author:<handle>`, or `kit:<id>`. Anything else can never match a real
      // source key, so reject it rather than persist inert junk. Dedup + bound.
      const VALID_KEY = /^(author:self|author:[a-z0-9-]{1,40}|kit:[A-Za-z0-9_-]{1,64})$/;
      const keys = [...new Set(raw.filter((k): k is string => typeof k === 'string' && VALID_KEY.test(k)))].slice(
        0,
        500,
      );

      const db = requirePrisma(prisma);
      const owns = await db.devices.findFirst({
        where: { id: device_id, user_id: userId },
        select: { id: true },
      });
      if (!owns) return reply.code(404).send({ error: 'device_not_found' });
      await runPrismaTransaction(db, async (tx) => {
        await tx.device_kit_excludes.deleteMany({ where: { device_id } });
        if (keys.length > 0) {
          await tx.device_kit_excludes.createMany({
            data: keys.map((source_key) => ({ device_id, source_key })),
          });
        }
      });
      return reply.send({ excluded: keys });
    },
  );

  // PROTOCOL §5 / §4: claim a handle and register the author Ed25519 public key.
  // Claim is a publish/claim-scope route, so it goes through
  // requireScope('claim') — sessions with no IdP-verified email get
  // 403 account_verification_required.
  app.post<{ Body: ClaimBody }>(
    '/api/v1/claim',
    { preHandler: requireScope('claim') },
    async (req, reply) => {
      const principal = req.principal as { user_id: string; handle: string | null };
      const { handle, public_key, key_id } = req.body ?? {};

      if (!handle || typeof handle !== 'string') {
        return reply.code(400).send({ error: 'handle_required' });
      }
      if (!HANDLE_RE.test(handle)) {
        return reply.code(400).send({ error: 'invalid_handle' });
      }
      const db = requirePrisma(prisma);
      // Reserved names can't be claimed unless this principal already
      // owns the handle or ops allowlisted their verified email (brand account).
      if (isReservedHandle(handle) && principal.handle !== handle) {
        const brandClaimAllowlist = parseBrandClaimAllowlist(
          process.env.SKILLET_BRAND_CLAIM_ALLOWLIST,
        );
        let allowed = false;
        const emails = brandClaimAllowlist.get(handle);
        if (emails) {
          for (const email of emails) {
            if (await userHasVerifiedEmailMatchPrisma(db, principal.user_id, email)) {
              allowed = true;
              break;
            }
          }
        }
        if (!allowed) {
          return reply.code(409).send({ error: 'handle_reserved' });
        }
      }
      // Mirror handles (seeded from a public repo) are claimable ONLY by the real
      // brand, via the same verified-email allowlist — so a random user can't grab
      // @cloudflare. The claim itself freezes the auto-sync (stamped below).
      const mirrorRow = await db.authors.findUnique({
        where: { id: handle },
        select: { is_mirror: true, mirror_claimed_at: true },
      });
      const claimingMirror =
        mirrorRow?.is_mirror === 1 &&
        mirrorRow.mirror_claimed_at == null &&
        principal.handle !== handle;
      if (claimingMirror) {
        const brandClaimAllowlist = parseBrandClaimAllowlist(
          process.env.SKILLET_BRAND_CLAIM_ALLOWLIST,
        );
        let allowed = false;
        if (principal.handle === handle) allowed = true;
        else {
          const emails = brandClaimAllowlist.get(handle);
          if (emails) {
            for (const email of emails) {
              if (await userHasVerifiedEmailMatchPrisma(db, principal.user_id, email)) {
                allowed = true;
                break;
              }
            }
          }
        }
        if (!allowed) {
          return reply.code(409).send({
            error: 'handle_reserved',
            message:
              'This handle mirrors a public repo. Claiming it requires verifying you own the brand.',
          });
        }
      }
      if (!public_key || typeof public_key !== 'string') {
        return reply.code(400).send({ error: 'public_key_required' });
      }
      // PROTOCOL §4 — registration-time validation of the trust-root key.
      // After TOFU close (Fix 1) a user who registers garbage is permanently
      // locked into a key that can't sign anything, so the failure must
      // surface here, not silently at verify time on the client.
      // Ed25519 raw pubkeys are exactly 32 bytes; base64 of 32 bytes
      // decodes to 32 bytes.
      let pkBuf: Buffer;
      try {
        pkBuf = Buffer.from(public_key, 'base64');
      } catch {
        return reply.code(400).send({ error: 'invalid_public_key' });
      }
      if (pkBuf.length !== 32) {
        return reply.code(400).send({ error: 'invalid_public_key' });
      }
      if (!key_id || typeof key_id !== 'string') {
        return reply.code(400).send({ error: 'key_id_required' });
      }
      // PROTOCOL §4: key_id MUST equal hex(raw pubkey bytes) — the same
      // binding every client trust path asserts (assertKeyIdBindsPub). A
      // mismatched registration poisons the account permanently: every add of
      // the author's skills fails signature_invalid on the derived-id check.
      if (key_id !== pkBuf.toString('hex')) {
        return reply.code(400).send({
          error: 'key_id_mismatch',
          message: 'key_id must be the hex encoding of the raw Ed25519 public key bytes.',
        });
      }

      if (principal.handle && principal.handle !== handle) {
        return reply.code(409).send({ error: 'already_claimed', handle: principal.handle });
      }

      // Global uniqueness: reject if the handle is taken by another user OR by
      // any organization slug (the two share the authors.id namespace).
      if (await handleOrSlugTakenPrisma(db, handle, principal.user_id)) {
        return reply.code(409).send({ error: 'name_taken' });
      }

      // PROTOCOL §4 trust root: TOFU forbids silent author-key replacement.
      const existing = await db.users.findUnique({
        where: { id: principal.user_id },
        select: { author_public_key: true, author_key_id: true },
      });

      if (existing?.author_public_key) {
        if (existing.author_public_key !== public_key || existing.author_key_id !== key_id) {
          return reply.code(409).send({
            error: 'key_change_forbidden',
            message:
              'Handle is already bound to a different author key. Key rotation is reserved for v2.',
          });
        }
        return reply.code(200).send({ handle, key_id });
      }

      await runPrismaTransaction(db, async (tx) => {
        await tx.users.update({
          where: { id: principal.user_id },
          data: {
            handle,
            author_public_key: public_key,
            author_key_id: key_id,
          },
        });
        await tx.authors.createMany({
          data: [{ id: handle, name: handle }],
          skipDuplicates: true,
        });
        await applyIdpProfileToAuthorPrisma(
          tx,
          handle,
          await identityProfileHintsPrisma(tx, principal.user_id),
        );
        if (claimingMirror) {
          await tx.authors.updateMany({
            where: {
              id: handle,
              is_mirror: 1,
              mirror_claimed_at: null,
            },
            data: { mirror_claimed_at: Math.floor(Date.now() / 1000) },
          });
        }
        await tx.author_keys.createMany({
          data: [
            {
              id: newId(),
              user_id: principal.user_id,
              key_id,
              public_key,
              label: 'cli-primary',
              created_at: Math.floor(Date.now() / 1000),
            },
          ],
          skipDuplicates: true,
        });
        await resolvePendingByHandlePrisma(tx, principal.user_id, handle);
      });
      return reply.code(201).send({ handle, key_id });
    },
  );

  // Server-to-server "claim via GitHub". The trusted web BFF has already
  // proven, from the claimant's OWN read:org token, that they are a GitHub org
  // owner of / repo admin on the mirror's source. It calls this HMAC-signed
  // endpoint to perform the claim. NEVER browser-reachable: the BFF proxy blocks
  // `api/v1/auth/web/*` and strips the signing headers, so a browser can't
  // originate it. The registry is the authorization boundary, so it does NOT
  // trust the BFF's handle derivation — it re-parses the owner from the mirror's
  // stored source URL itself before granting.
  app.post<{ Body: ClaimGithubBody }>(
    '/api/v1/auth/web/claim-github',
    async (req, reply) => {
      if (!webInternalAuthorized(req)) {
        return reply.code(401).send({ error: 'web_internal_auth_required' });
      }

      const body = req.body ?? {};
      const handle = typeof body.handle === 'string' ? body.handle.toLowerCase() : '';
      const githubLogin =
        typeof body.github_login === 'string' ? body.github_login.toLowerCase() : '';
      const githubId = body.github_id;
      // `end_state` is advisory only (see ClaimGithubBody) — accepted but never
      // branched on. Every logged-in claim grants an org the claimant owns.
      const userId = typeof body.user_id === 'string' ? body.user_id : '';

      if (!handle || !HANDLE_RE.test(handle)) {
        return reply.code(400).send({ error: 'invalid_handle' });
      }
      if (!githubLogin) {
        return reply.code(400).send({ error: 'github_login_required' });
      }
      // Numeric GitHub id binds the claim to the account identity, not just the
      // login, so a freed-and-reused login can't inherit it.
      if (typeof githubId !== 'number' || !Number.isInteger(githubId) || githubId <= 0) {
        return reply.code(400).send({ error: 'github_id_required' });
      }
      if (!userId) {
        return reply.code(400).send({ error: 'user_id_required' });
      }

      // Rate-limit BEFORE the claim work, counting all attempts incl. misses
      // (keyed on the claimant + handle, never the shared BFF egress IP).
      const limited = claimGithubRateLimited(`${userId}:${handle}`);
      if (limited) {
        req.log.warn(
          { handle, scope: limited.scope },
          'claim-github rate limit tripped — possible abuse; investigate',
        );
        reply.header('Retry-After', String(limited.retryAfter));
        return reply.code(429).send({
          error: 'rate_limited',
          scope: limited.scope,
          retry_after_seconds: limited.retryAfter,
        });
      }

      const db = requirePrisma(prisma);
      const claimant = await db.users.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!claimant) {
        return reply.code(401).send({ error: 'unknown_user' });
      }

      // KTD9 independent re-bind: read the mirror's stored source URL and parse
      // the owner login OURSELVES, then assert it equals the attested login.
      const mirror = await db.authors.findUnique({
        where: { id: handle },
        select: {
          name: true,
          is_mirror: true,
          mirror_claimed_at: true,
          mirror_source_url: true,
        },
      });
      if (!mirror) {
        return reply.code(404).send({ error: 'mirror_not_found' });
      }
      if (mirror.is_mirror !== 1) {
        return reply.code(409).send({ error: 'not_a_mirror' });
      }
      const ownerLogin = parseMirrorOwnerLogin(mirror.mirror_source_url);
      if (!ownerLogin || ownerLogin !== githubLogin) {
        req.log.warn(
          { handle, attested: githubLogin, parsed: ownerLogin },
          'claim-github owner re-bind mismatch — refusing grant',
        );
        return reply.code(422).send({ error: 'owner_mismatch' });
      }

      const name = mirror.name ?? handle;
      try {
        const result = await grantBrandOrgPrisma(db, {
          handle,
          ownerUserId: userId,
          name,
        });
        // Record the verified GitHub numeric id on the org (anti rename-reuse,
        // KTD5; also the KTD9 transfer-detection anchor).
        await db.organizations.update({
          where: { id: result.org_id },
          data: { source_owner_id: githubId },
        });
        return reply.code(201).send({
          end_state: 'org',
          org_id: result.org_id,
          slug: result.slug,
          owner_user_id: result.owner_user_id,
          already_claimed: false,
        });
      } catch (err) {
        if (err instanceof BrandGrantError) {
          // R4: a second eligible admin claiming an already-claimed org gets the
          // EXISTING org back (200) — a join affordance, never a re-grab.
          if (err.code === 'already_claimed') {
            const org = await getOrgBySlugPrisma(db, handle);
            if (org) {
              return reply.code(200).send({
                end_state: 'org',
                org_id: org.id,
                slug: org.slug,
                owner_user_id: org.owner_user_id,
                already_claimed: true,
              });
            }
            return reply.code(409).send({ error: 'already_claimed' });
          }
          if (err.code === 'name_taken') return reply.code(409).send({ error: 'name_taken' });
          if (err.code === 'org_exists') return reply.code(409).send({ error: 'org_exists' });
          if (err.code === 'not_a_mirror') return reply.code(409).send({ error: 'not_a_mirror' });
        }
        throw err;
      }
    },
  );

  // Server-to-server "account-bootstrap via GitHub" — the logged-OUT brand-claim
  // path. A person with NO Skillet account proves (BFF-attested, from their OWN
  // read:org token) they own the personal GitHub repo a mirror tracks; the BFF
  // additionally reads their verified primary email (user:email scope) and calls
  // this HMAC-signed endpoint to MINT them an account whose handle == the mirror
  // handle. This is a deliberate, scoped carve-out from the "GitHub is link-only,
  // never creates accounts" rule — gated HARD, fail-closed, idempotent:
  //   - HMAC required (BFF origin); NEVER browser-reachable (proxy blocks
  //     `api/v1/auth/web/*` and strips the signing headers).
  //   - The mirror must be an UNCLAIMED mirror whose source is a USER (never an
  //     Organization — an org source can never bootstrap a personal account).
  //   - Independent owner re-bind: the owner parsed from the mirror's stored source
  //     URL must equal the attested github_login — a BFF bug can't grant.
  //   - If an account ALREADY exists for this GitHub identity or this verified
  //     email, refuse to fork a duplicate: return {account_exists:true} so the BFF
  //     sends them to log in instead (avoids account sprawl).
  //   - Rate-limited by request IP + a global cap, counting all attempts.
  app.post<{ Body: ClaimGithubBootstrapBody }>(
    '/api/v1/auth/web/claim-github-bootstrap',
    async (req, reply) => {
      if (!webInternalAuthorized(req)) {
        return reply.code(401).send({ error: 'web_internal_auth_required' });
      }

      const body = req.body ?? {};
      const handle = typeof body.handle === 'string' ? body.handle.toLowerCase() : '';
      const githubLogin =
        typeof body.github_login === 'string' ? body.github_login.toLowerCase() : '';
      const githubId = body.github_id;
      const verifiedEmail =
        typeof body.verified_email === 'string' ? body.verified_email.trim().toLowerCase() : '';

      if (!handle || !HANDLE_RE.test(handle)) {
        return reply.code(400).send({ error: 'invalid_handle' });
      }
      if (!githubLogin) {
        return reply.code(400).send({ error: 'github_login_required' });
      }
      if (typeof githubId !== 'number' || !Number.isInteger(githubId) || githubId <= 0) {
        return reply.code(400).send({ error: 'github_id_required' });
      }
      if (!verifiedEmail || !EMAIL_RE.test(verifiedEmail)) {
        return reply.code(400).send({ error: 'verified_email_required' });
      }

      // Rate-limit BEFORE any work, counting all attempts incl. misses. Keyed on the
      // request IP (a logged-out caller has no user_id) plus a global cap — this is
      // an unauthenticated account-minting surface.
      const limited = bootstrapRateLimited(req.ip || 'unknown');
      if (limited) {
        req.log.warn(
          { handle, scope: limited.scope },
          'claim-github-bootstrap rate limit tripped — possible abuse; investigate',
        );
        reply.header('Retry-After', String(limited.retryAfter));
        return reply.code(429).send({
          error: 'rate_limited',
          scope: limited.scope,
          retry_after_seconds: limited.retryAfter,
        });
      }

      // Read the mirror row once: source URL (for the re-bind), mirror/claim state,
      // and the source owner TYPE (must be 'User' to bootstrap a personal account).
      const db = requirePrisma(prisma);
      const mirror = await db.authors.findUnique({
        where: { id: handle },
        select: {
          is_mirror: true,
          mirror_claimed_at: true,
          mirror_source_url: true,
          source_owner_type: true,
        },
      });
      if (!mirror) {
        return reply.code(404).send({ error: 'mirror_not_found' });
      }

      // Gate 1: independent owner re-bind. Parse the owner from the mirror's
      // stored source URL OURSELVES and assert it equals the attested login.
      const ownerLogin = parseMirrorOwnerLogin(mirror.mirror_source_url);
      if (!ownerLogin || ownerLogin !== githubLogin) {
        req.log.warn(
          { handle, attested: githubLogin, parsed: ownerLogin },
          'claim-github-bootstrap owner re-bind mismatch — refusing',
        );
        return reply.code(422).send({ error: 'owner_mismatch' });
      }

      // Gate 2: must be an UNCLAIMED mirror whose source is a USER. An Organization
      // (or unknown/NULL) source can NEVER bootstrap a personal account.
      if (mirror.is_mirror !== 1) {
        return reply.code(409).send({ error: 'not_a_mirror' });
      }
      if (mirror.mirror_claimed_at != null) {
        return reply.code(409).send({ error: 'already_claimed' });
      }
      if (mirror.source_owner_type !== 'User') {
        return reply.code(409).send({ error: 'not_a_user_source' });
      }

      // Gate 3: never fork a duplicate. If an account already exists for this GitHub
      // identity (by numeric id, incl. the legacy users.github_id) OR for the
      // verified email, signal account_exists so the BFF redirects them to log in.
      const githubSubject = String(githubId);
      const existingByGithub =
        (await db.user_identities.findFirst({
          where: { provider: 'github', provider_subject_id: githubSubject },
          select: { user_id: true },
        })) ??
        (await db.users.findFirst({
          where: { github_id: githubSubject },
          select: { id: true },
        }));
      const existingByEmail = await userIdByVerifiedEmailPrisma(db, verifiedEmail);
      if (existingByGithub || existingByEmail) {
        return reply.code(200).send({ account_exists: true });
      }

      if (await handleOrSlugTakenPrisma(db, handle)) {
        return reply.code(409).send({ error: 'name_taken' });
      }

      const newUserId = newId();
      await db.users.create({
        data: {
          id: newUserId,
          handle: null,
          github_id: githubSubject,
          two_factor: 0,
        },
      });
      await upsertIdentityUserPrisma(
        db,
        {
          provider: 'github',
          provider_subject_id: githubSubject,
          email: verifiedEmail,
          email_verified: true,
          login: githubLogin,
        },
        newUserId,
      );
      try {
        await claimMirrorAsUserPrisma(db, { handle, ownerUserId: newUserId });
      } catch (err) {
        if (err instanceof BrandGrantError) {
          if (err.code === 'already_claimed') return reply.code(409).send({ error: 'already_claimed' });
          if (err.code === 'name_taken') return reply.code(409).send({ error: 'name_taken' });
          if (err.code === 'not_a_mirror') return reply.code(409).send({ error: 'not_a_mirror' });
        }
        throw err;
      }
      const session = await mintSessionForUserPrisma(db, newUserId);
      return reply.code(201).send({
        account_exists: false,
        session_token: session.session_token,
        session_id: session.session_id,
        expires_at: session.expires_at,
        user_id: newUserId,
        handle,
      });
    },
  );

  // PROTOCOL §5: identity introspection for any valid bearer token. Devices
  // are always account-bound, so a device whoami never reports a null user_id;
  // a dangling device token fails auth (401) before reaching this handler.
  app.get('/api/v1/whoami', async (req, reply) => {
    if (!req.principal) {
      return reply.code(401).send(authRequiredBody(req));
    }
    const p = req.principal;
    if (p.class === 'device') {
      // Fail closed on an unpaired/null-user device, mirroring /sync/manifest —
      // one shared invariant for the same anomalous row (schema-impossible
      // post-049, reachable only mid-deploy or via an out-of-band row).
      if (p.user_id === null) {
        return reply.code(403).send({ error: 'device_not_paired', message: pairFlowGuidance() });
      }
      // A device carries user_id but not the handle — resolve it (and the
      // avatar) so clients can show the real account, not a fallback.
      const db = requirePrisma(prisma);
      const userRow = await db.users.findUnique({
        where: { id: p.user_id },
        select: { handle: true },
      });
      const handle = userRow?.handle ?? null;
      const avatarRow = handle
        ? await db.authors.findUnique({
            where: { id: handle },
            select: { avatar_url: true },
          })
        : null;
      return reply.send({
        token_class: 'device',
        device_id: p.device_id,
        user_id: p.user_id,
        handle,
        avatar_url: avatarRow?.avatar_url ?? null,
        scopes: p.scopes,
      });
    }
    if (p.class === 'session') {
      const db = requirePrisma(prisma);
      const userRow = await db.users.findUnique({
        where: { id: p.user_id },
        select: { author_key_id: true },
      });
      const avatarRow = p.handle
        ? await db.authors.findUnique({
            where: { id: p.handle },
            select: { avatar_url: true },
          })
        : null;
      return reply.send({
        token_class: 'session',
        user_id: p.user_id,
        handle: p.handle,
        avatar_url: avatarRow?.avatar_url ?? null,
        email: await userPrimaryEmailPrisma(db, p.user_id),
        two_factor: p.two_factor,
        scopes: p.scopes,
        author_key_id: userRow?.author_key_id ?? null,
        linked_providers: await userLinkedProvidersPrisma(db, p.user_id),
        github_linked: await userHasGithubIdentityPrisma(db, p.user_id),
        // Brand-claim eligibility listing is deferred until that helper is Prisma-only.
        brand_claim_eligible: [],
      });
    }
    if (p.class === 'kit') {
      return reply.send({
        token_class: 'kit',
        kit_key_id: p.kit_key_id,
        kit_id: p.kit_id,
        scopes: p.scopes,
      });
    }
    return reply.send({
      token_class: 'mcp',
      mcp_link_id: p.mcp_link_id,
      user_id: p.user_id,
      scopes: p.scopes,
    });
  });

  // (The email-pairing session pickup endpoint was retired with the magic-link
  // pipe; the CLI pairs via `skillet connect <code>` / POST /connect/claim.)

  // §5 — revoke the calling session. Idempotent: a second logout on
  // the same token is a 401 (the token is already unresolvable).
  app.post('/api/v1/auth/logout', { preHandler: requireSession }, async (req, reply) => {
    const sessionId = (req.principal as { session_id: string }).session_id;
    const now = Math.floor(Date.now() / 1000);
    const db = requirePrisma(prisma);
    await db.sessions.updateMany({
      where: { id: sessionId, revoked_at: null },
      data: { revoked_at: now },
    });
    return reply.code(204).send();
  });

  // DEV-ONLY session minter. Refuses in production. Tests and the Connect
  // wizard scaffolding use this until the GitHub OAuth callback ships in the
  // follow-up issue. Keeping it in-tree (and refusing in prod) is safer than
  // a parallel mock that can drift from the real token shape.
  app.post<{ Body: DevSessionBody }>('/api/v1/sessions/dev', async (req, reply) => {
    // Fail-closed: only reachable when explicitly enabled (in-memory DB / env),
    // never merely because NODE_ENV isn't the exact string 'production'.
    if (!opts.devAuth) {
      return reply.code(404).send({ error: 'not_found' });
    }
    const handle = req.body?.handle;
    const twoFactor = req.body?.two_factor ? 1 : 0;
    const now = Math.floor(Date.now() / 1000);
    const sessionId = newId();
    const { secret, hash } = mintToken('session');
    const db = requirePrisma(prisma);

    let userId: string;
    const existing = handle
      ? await db.users.findFirst({ where: { handle }, select: { id: true } })
      : null;
    if (existing) {
      userId = existing.id;
    } else {
      if (handle && (await handleOrSlugTakenPrisma(db, handle))) {
        return reply.code(409).send({ error: 'name_taken' });
      }
      userId = newId();
      await db.users.create({
        data: {
          id: userId,
          handle: handle ?? null,
          github_id: null,
          two_factor: twoFactor,
        },
      });
      await db.user_identities.create({
        data: {
          user_id: userId,
          provider: 'google',
          provider_subject_id: `dev-${userId}`,
          email: `dev-${userId}@dev.local`,
          email_verified: 1,
          created_at: now,
        },
      });
    }
    await db.sessions.create({
      data: {
        id: sessionId,
        user_id: userId,
        token_hash: hash,
        expires_at: now + sessionTtlSec(),
      },
    });
    return reply.code(201).send({
      user_id: userId,
      session_token: secret,
      handle: handle ?? null,
      scopes: scopesFor('session'),
    });
  });
}
