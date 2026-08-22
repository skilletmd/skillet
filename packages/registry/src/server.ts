import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'
import { randomUUID } from 'node:crypto'
import { STATUS_CODES } from 'node:http'
import type { DatabaseSync } from './db/sqlite-handle.js'
import { unavailableSqliteHandle } from './db/sqlite-handle.js'
import { REGISTRY_VERSION_PREFIX } from '@skillet/protocol'
import { createPrismaClient, requireDatabaseUrl } from './db/prisma-client.js'
import { createBlobStore } from './blob-store/index.js'
import type { BlobStore } from './blob-store/types.js'
import { AvatarStore, avatarStoreConfigFromEnv } from './avatars/avatar-store.js'
import { registerSkillRoutes } from './routes/skills.js'
import { registerReportRoutes } from './routes/reports.js'
import { registerModerationRoutes } from './routes/moderation.js'
import { registerKitRoutes } from './routes/kits.js'
import { registerProfileRoutes } from './routes/profiles.js'
import { registerAuthRoutes, type AuthRouteOptions } from './routes/auth.js'
import { registerDeviceAgentRoutes } from './routes/device-agents.js'
import { registerDeviceSyncStreamRoutes } from './routes/device-sync-stream.js'
import { registerDelegationRoutes } from './routes/delegations.js'
import { registerKitMemberRoutes } from './routes/kit-members.js'
import { registerKitSubscriptionRoutes } from './routes/kit-subscriptions.js'
import { registerOrgRoutes } from './routes/orgs.js'
import { registerAdminRoutes } from './routes/admin.js'
import { registerMirrorQueueRoutes } from './routes/mirror-queue.js'
import { registerEventRoutes } from './routes/events.js'
import { registerAvailabilityRoutes } from './routes/availability.js'
import { registerAuthDecorator } from './auth/middleware.js'
import { registerSyncRoutes } from './routes/sync.js'
import { registerAdapterRoutes, type AdapterRoutesOptions } from './routes/adapters.js'
import { registerProposalRoutes } from './routes/proposals.js'
import { registerFollowRoutes } from './routes/follows.js'
import { registerNotificationRoutes } from './routes/notifications.js'
import { registerAttentionStreamRoutes } from './routes/events-stream.js'
import { registerAccountRoutes } from './routes/account.js'
import { registerApprovalRoutes } from './routes/approvals.js'
import { registerDiscoverRoutes } from './routes/discover.js'
import { registerStatsRoutes } from './routes/stats.js'
import { registerWebAuthRoutes } from './auth/web-routes.js'
import { configuredSigningSecrets } from './auth/web-internal-sig.js'
import { parseInternalOriginAllowlist, isInternalOnlyPath } from './auth/internal-origin.js'
import { registerEmailLoginCodeRoutes } from './auth/email-login-code.js'
import { registerAuthorKeyRoutes } from './routes/author-keys.js'
import { registerSearchRoutes } from './routes/search.js'
import { registerConnectPairRoutes } from './routes/connect-pair.js'
import { registerMcpRoutes } from './routes/mcp.js'
import { registerConnectedRepoRoutes } from './routes/connected-repos.js'
import { registerHttpSecurity } from './http-security.js'
import { registerOpenApiRoutes } from './routes/openapi.js'
import { registerErrorEnvelope } from './error-envelope.js'

declare module 'fastify' {
  interface FastifyInstance {
    skilletDb: DatabaseSync
    /** Present when DATABASE_URL is set (Prisma MySQL cutover path). */
    skilletPrisma?: import('@prisma/client').PrismaClient
    /**
     * True when registerAuthDecorator opted into Prisma as the live auth store.
     * Guards (requireAdmin / requireScope) follow this flag so they do not read
     * MySQL while sessions still live in sqlite.
     */
    skilletPrismaAuth?: boolean
  }
}

export interface ServerOptions {
  /**
   * Inject a legacy sqlite handle for characterization tests only.
   * Production always uses {@link usePrismaAuth} + MySQL.
   */
  db?: DatabaseSync
  /**
   * @deprecated Prefer {@link db} injection for characterization; ignored when
   * usePrismaAuth is set.
   */
  dbPath?: string
  /**
   * `true` → error-level logging, `false`/unset → silent. Tests that assert on
   * log output (e.g. MCP token redaction) pass a full Fastify logger config
   * (level + capture stream) instead.
   */
  logger?: boolean | Exclude<FastifyServerOptions['logger'], boolean | undefined>
  auth?: AuthRouteOptions
  /**
   * Run the post-publish harm scan synchronously inside the publish
   * handler. Tests rely on this to assert scan state without polling; the
   * default (false) defers to `setImmediate` so production publishes return
   * before detector wall time accumulates.
   */
  scanSync?: boolean
  /**
   * §10 adapter manifest signing key (hex-encoded PKCS#8 DER of an Ed25519
   * private key). When set, GET /adapters/manifest includes a valid signature
   * envelope. Falls back to SKILLET_ADAPTER_RELEASE_KEY env var. When neither is
   * set, the signature field is null (dev / unsigned mode).
   */
  adapterSigningKeyHex?: string
  /**
   * Fastify proxy-trust setting that controls how `req.ip` (and the
   * per-IP magic-link cap that keys on it) is derived. Programmatic
   * override; when omitted we resolve `TRUST_PROXY` from the environment via
   * {@link resolveTrustProxy}. See that function for the value grammar and the
   * deployment contract.
   */
  trustProxy?: boolean | number | string
  /**
   * Trusted TCP peers (comma-separated IPs / CIDRs) for the internal mint/link
   * routes — the network-origin lock. Programmatic override; when omitted we read
   * `SKILLET_INTERNAL_ORIGIN_ALLOWLIST`. Unset → no lock (current behavior). See
   * {@link parseInternalOriginAllowlist}.
   */
  internalOriginAllowlist?: string
  /** Override blob store (tests). Default: `createBlobStore(db)` from env. */
  blobStore?: BlobStore
  /**
   * When true, auth decorator + session mint use Prisma (MySQL). Live main
   * always sets this; characterization may omit it and inject {@link db}.
   */
  usePrismaAuth?: boolean
  /**
   * Override the avatar store (tests). Default: lazily built from R2_AVATARS_*
   * env on the first avatar upload, so the server boots without avatar config —
   * only an actual upload requires it.
   */
  avatarStore?: AvatarStore
}

/**
 * Resolve Fastify's `trustProxy` from the `TRUST_PROXY` env var.
 *
 * Why this matters: `req.ip` (and the per-IP magic-link send cap that
 * keys on it) is only meaningful if Fastify knows whether it sits behind a
 * proxy. With trust OFF, Fastify ignores `X-Forwarded-For` and reports the
 * socket peer — correct when the registry is exposed directly. With trust ON,
 * Fastify honors `X-Forwarded-For` to recover the real client IP — correct
 * behind a proxy/LB. Trusting XFF when there is no proxy in front lets any
 * caller spoof their IP and bypass the per-IP cap, so trust must be OFF by
 * default and turned on **only** for proxied deployments.
 *
 * Deployment contract (set `TRUST_PROXY` per topology):
 *   - unset / "false" / "0" / "off" / "no" / ""  → trust OFF (default; XFF
 *     ignored). Use when the container is reached directly (local dev, a single
 *     box binding 0.0.0.0, or a proxy that strips and re-sets a trusted header
 *     you terminate elsewhere).
 *   - a positive integer (e.g. "1", "2")         → trust exactly that many
 *     proxy hops. Preferred for Fly / Render / Cloud Run / ALB / nginx: set it
 *     to the number of proxies that append to XFF in front of the registry
 *     (usually 1). Counting hops cannot be spoofed by an extra client-supplied
 *     XFF entry the way a blanket `true` can.
 *   - "true" / "1"-as-bool alias / "on" / "yes"  → trust all upstream hops.
 *     Only safe when every path to the port is through a proxy you control.
 *   - anything else                              → passed through verbatim to
 *     Fastify as a trusted IP/CIDR allowlist (comma-separated supported), e.g.
 *     "127.0.0.1,10.0.0.0/8".
 *
 * Note "1" is intentionally treated as a hop count (number), not the boolean
 * alias — a single trusted hop is the overwhelmingly common proxied setup and
 * the safer interpretation.
 */
export function resolveTrustProxy(raw: string | undefined): boolean | number | string {
  if (raw == null) return false
  const v = raw.trim()
  if (v === '') return false
  const lower = v.toLowerCase()
  if (lower === 'false' || lower === '0' || lower === 'off' || lower === 'no') {
    return false
  }
  if (lower === 'true' || lower === 'on' || lower === 'yes') {
    return true
  }
  // Plain positive integer → number of trusted proxy hops.
  if (/^\d+$/.test(v)) {
    return Number(v)
  }
  // Otherwise treat as a trusted IP/CIDR allowlist passed straight to Fastify.
  return v
}


/**
 * Guard the single most dangerous misconfiguration of the dev-auth switch:
 * `SKILLET_ENABLE_DEV_AUTH=1` in production. The flag is a local-only "relax
 * everything" toggle — it opens the no-secret session-mint bypass AND (in
 * sync/repo-auth.ts and routes/mcp.ts) swaps the at-rest encryption keys to
 * deterministic, source-readable dev keys. Session-mint is already gated to an
 * explicit dev-auth opt (see `resolveDevAuth` below), but those two encryption-key
 * fallbacks read the flag DIRECTLY, so a flag left on in production would encrypt
 * real GitHub + MCP tokens under a public key. Refuse to boot instead, and name
 * the real keys — an operator
 * hitting a fail-closed key error must not be able to "fix" it by flipping this.
 */
/**
 * Resolve whether dev-only auth affordances (dev session minting, the login-code
 * `dev_code` response) are active. Fail-closed: a programmatic opt wins; otherwise
 * ON only for an in-memory DB (tests) or an explicit SKILLET_ENABLE_DEV_AUTH=1.
 * Deliberately does NOT consider NODE_ENV or usePrismaAuth — relying on the mere
 * absence of NODE_ENV==='production' is the fail-open a self-host trips into.
 */
export function resolveDevAuth(
  opts: { authDevAuth?: boolean; dbPath?: string },
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (opts.authDevAuth !== undefined) return opts.authDevAuth
  return opts.dbPath === ':memory:' || env.SKILLET_ENABLE_DEV_AUTH === '1'
}

export function assertDevAuthNotInProduction(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production' && env.SKILLET_ENABLE_DEV_AUTH === '1') {
    throw new Error(
      'SKILLET_ENABLE_DEV_AUTH=1 with NODE_ENV=production: this dev-only flag enables ' +
        'source-readable encryption/signing keys and must never run in production. Unset it ' +
        'and configure the real secrets instead — SKILLET_WEB_SIGNING_SECRET, ' +
        'SKILLET_REPO_TOKEN_KEY (connect-your-repo), SKILLET_MCP_TOKEN_KEY (hosted MCP links).',
    )
  }
}

export async function buildServer(opts: ServerOptions = {}): Promise<{
  app: ReturnType<typeof Fastify>
  db: DatabaseSync
  blobStore: BlobStore
}> {
  assertDevAuthNotInProduction()

  // U6: Prisma boot never opens node:sqlite. register* still take a typed
  // handle for signature stability; pass an unavailable stub so accidental
  // fallthrough fails loudly. Characterization injects opts.db or opts.dbPath
  // (tests/legacy-sqlite-open) explicitly.
  let prisma: ReturnType<typeof createPrismaClient> | undefined
  if (opts.usePrismaAuth === true) {
    const databaseUrl = requireDatabaseUrl()
    prisma = createPrismaClient({ databaseUrl })
  }

  let db: DatabaseSync
  if (opts.usePrismaAuth === true) {
    db = unavailableSqliteHandle()
  } else if (opts.db) {
    db = opts.db
  } else if (opts.dbPath !== undefined) {
    // Characterization / cross-package e2e only. Specifier is built at runtime so
    // tsc does not pull tests/ into the src rootDir program; module lives outside
    // src/ so the gap test stays green.
    const legacySpec = new URL('../tests/legacy-sqlite-open.js', import.meta.url).href
    const legacy = (await import(legacySpec)) as {
      openLegacySqlite: (path?: string) => DatabaseSync
    }
    db = legacy.openLegacySqlite(opts.dbPath)
  } else {
    throw new Error(
      'buildServer requires usePrismaAuth: true (MySQL), opts.db, or opts.dbPath for legacy characterization',
    )
  }
  // Mirrors/seeds published before platform attestation existed carry no
  // signature and are rejected by device sync — sign them once at boot.
  // Idempotent, pure DB work (no blob reads). Skip on the Prisma-primary path.
  // Sqlite body lives under tests/ after U5; load it only for characterization.
  if (!opts.usePrismaAuth) {
    const legacySpec = new URL('../tests/legacy-sqlite-platform-signing.js', import.meta.url).href
    const legacy = (await import(legacySpec)) as {
      backfillUnsignedVersions: (handle: DatabaseSync) => number
    }
    const attested = legacy.backfillUnsignedVersions(db)
    if (attested > 0) {
      console.log(`platform-signing: attested ${attested} previously-unsigned version(s)`)
    }
  }

  const blobStore =
    opts.blobStore ??
    createBlobStore(db, opts.usePrismaAuth && prisma ? prisma : undefined)
  const logger: FastifyServerOptions['logger'] =
    typeof opts.logger === 'object'
      ? opts.logger
      : opts.logger
        ? { level: 'error' }
        : false
  // Proxy trust gates how `req.ip` is derived for the per-IP
  // magic-link cap. Default OFF (XFF ignored) so an un-proxied deployment cannot
  // be spoofed; enable per topology via TRUST_PROXY. Programmatic opts win for
  // tests / embedders.
  const trustProxy = opts.trustProxy ?? resolveTrustProxy(process.env.TRUST_PROXY)
  // §2.1 caps the bundle at 25 MB. With base64 overhead (~33%) we need ~34 MB
  // of headroom on the JSON body endpoint; the protocol-level validator returns
  // the proper `bundle_too_large` 422 inside the request.
  // Non-sequential request id. Fastify's default is an incrementing integer,
  // which leaks request volume/ordering and isn't safe to echo to clients. A
  // random UUID is opaque, collision-free, and lets a 5xx response carry an id
  // that correlates to the full server-side log without exposing anything.
  const app = Fastify({
    logger,
    bodyLimit: 40 * 1024 * 1024,
    trustProxy,
    genReqId: () => randomUUID(),
  })
  app.decorate('skilletDb', db)

  if (prisma) {
    app.decorate('skilletPrisma', prisma)
    app.addHook('onClose', async () => {
      await prisma.$disconnect()
    })
  }

  // Avatar uploads arrive as raw image/webp bytes (the web BFF re-encodes before
  // forwarding). Parse them straight to a Buffer — Fastify only ships json/text
  // parsers by default, so without this the avatar route would never see a body.
  // Per-route bodyLimit on /profiles/:author/avatar bounds the actual size.
  app.addContentTypeParser(
    'image/webp',
    { parseAs: 'buffer' },
    (_req, body, done) => done(null, body),
  )

  // One global error handler so no unhandled throw — a `node:sqlite` error, a
  // verifier blow-up, a stray `throw` — ever ships `err.message`, SQL text, or
  // a stack to the client. The full error is logged server-side; the client
  // gets only a stable shape plus the request id. NOTE: this fires for *thrown*
  // errors and Fastify-internal failures (validation, body-limit) — it does NOT
  // intercept explicit `reply.send(...)`, so deliberate domain bodies are kept.
  // Fastify 5 types the handler error as `unknown` (was a loose Error-shaped type
  // in v4). We narrow status/code/message without assuming FastifyError.
  app.setErrorHandler((err, request, reply) => {
    // Log everything server-side (stack, message, SQL text) — never to the wire.
    request.log.error({ err, reqId: request.id }, 'request error')

    // Fastify sets `statusCode` on validation errors and on thrown HttpErrors;
    // a value < 500 is a deliberate client error we forward as-is (status, code,
    // message) rather than masking it as a 500. Anything >= 500 or unset is an
    // internal failure and is reduced to an opaque body.
    const errObj = typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : null
    const status = typeof errObj?.statusCode === 'number' ? errObj.statusCode : 500
    if (status >= 400 && status < 500) {
      const code = typeof errObj?.code === 'string' ? errObj.code : undefined
      const message = err instanceof Error ? err.message : 'Error'
      return reply.code(status).send({
        statusCode: status,
        ...(code ? { code } : {}),
        error: STATUS_CODES[status] ?? 'Error',
        message,
      })
    }
    return reply.code(status >= 500 ? status : 500).send({
      error: 'internal',
      request_id: request.id,
    })
  })

  // Every JSON error leaves with a stable `code` and a `docs` URL, whatever
  // shape the handler chose, and an unrouted path answers in that same shape.
  // Additive only — see error-envelope.ts.
  registerErrorEnvelope(app)

  await registerHttpSecurity(app)

  app.get('/api/hc', async () => ({ ok: true, ts: Date.now() }))

  // Machine-readable API description. Root + version-prefixed; see routes/openapi.ts.
  registerOpenApiRoutes(app)

  // Resolves Bearer tokens to req.principal for every route. Public reads
  // simply ignore it; auth-requiring handlers gate via requireSession.
  registerAuthDecorator(app, db, opts.usePrismaAuth && prisma ? { prisma } : undefined)

  // Auth routes hardcode `/api/v1/...` paths in their handlers,
  // so they register at the root level — outside the prefix mount that
  // handles the rest of the surface. The optional auth config
  // (GitHub OAuth credentials, 2FA gate) which threads through opts.auth.
  // Dev session minter is fail-closed: on ONLY for an in-memory DB (tests) or an
  // explicit SKILLET_ENABLE_DEV_AUTH=1 (local dogfooding). It is NOT gated on
  // NODE_ENV or the DB mode — a self-host that forgets NODE_ENV=production, or runs
  // the MySQL/Prisma path, must never get dev auth by default. The prod+flag combo
  // is separately refused at boot by assertDevAuthNotInProduction. Programmatic opt wins.
  const devAuth = resolveDevAuth({ authDevAuth: opts.auth?.devAuth, dbPath: opts.dbPath })

  // Network-origin lock for the internal mint/link routes. The HMAC signature is
  // one factor (a leaked secret = takeover); this enforces the "private network"
  // posture in code, checked against the un-spoofable TCP peer. Off in dev-auth
  // (tests / local). See auth/internal-origin.ts.
  const internalOrigin = parseInternalOriginAllowlist(
    opts.internalOriginAllowlist ?? process.env.SKILLET_INTERNAL_ORIGIN_ALLOWLIST,
  )
  if (!devAuth && configuredSigningSecrets().length > 0) {
    if (internalOrigin) {
      console.log(
        `internal-origin: mint/link routes locked to ${internalOrigin.entries.join(', ')}`,
      )
    } else {
      console.warn(
        'internal-origin: /api/v1/auth/web, /api/v1/auth/link and /api/v1/github/repos are NOT ' +
          'origin-locked — they rely solely on the web-signing secret. Keep them on a private ' +
          'network (Cloudflare Authenticated Origin Pulls / mTLS) and/or set ' +
          'SKILLET_INTERNAL_ORIGIN_ALLOWLIST to the trusted TCP peer(s).',
      )
    }
  }
  if (internalOrigin && !devAuth) {
    app.addHook('onRequest', async (req, reply) => {
      if (!isInternalOnlyPath(req.url)) return
      if (!internalOrigin.allows(req.socket.remoteAddress)) {
        // 404, not 403 — do not disclose that the internal surface exists here.
        return reply.code(404).send({ error: 'not_found' })
      }
    })
  }

  registerAuthRoutes(app, db, {
    ...opts.auth,
    devAuth,
    prisma: opts.usePrismaAuth && prisma ? prisma : undefined,
  })
  registerDeviceAgentRoutes(app, db, opts.usePrismaAuth && prisma ? prisma : undefined)
  registerDeviceSyncStreamRoutes(app, db, opts.usePrismaAuth && prisma ? prisma : undefined)
  registerConnectPairRoutes(app, db, opts.usePrismaAuth && prisma ? prisma : undefined)
  // Personal MCP link (mint / fetch / regenerate) + the hosted MCP serving
  // endpoint hardcode `/api/v1/...`.
  registerMcpRoutes(app, db, blobStore, opts.usePrismaAuth && prisma ? prisma : undefined)
  registerConnectedRepoRoutes(app, db, {
    devAuth,
    prisma: opts.usePrismaAuth && prisma ? prisma : undefined,
    blobStore,
  })
  // Device-key delegation routes hardcode `/api/v1/...` like auth.
  registerDelegationRoutes(app, db, opts.usePrismaAuth && prisma ? prisma : undefined)
  registerWebAuthRoutes(app, db, {
    devAuth,
    prisma: opts.usePrismaAuth && prisma ? prisma : undefined,
  })
  registerEmailLoginCodeRoutes(
    app,
    db,
    opts.usePrismaAuth && prisma ? prisma : undefined,
    devAuth,
  )
  registerAuthorKeyRoutes(app, db, opts.usePrismaAuth && prisma ? prisma : undefined)
  // Kit-member + kit-key-mint routes hardcode `/api/v1/...` too.
  registerKitMemberRoutes(app, opts.usePrismaAuth && prisma ? prisma : undefined)
  registerKitSubscriptionRoutes(app, opts.usePrismaAuth && prisma ? prisma : undefined)
  // Org/team routes hardcode `/api/v1/...` paths.
  registerOrgRoutes(app, opts.usePrismaAuth && prisma ? prisma : undefined, devAuth)
  // Platform-admin routes (mirror handoff, moderation) hardcode `/api/v1/...`.
  registerAdminRoutes(app, db, opts.usePrismaAuth && prisma ? prisma : undefined)
  // Mirror review queue (public submit + admin drain) hardcode `/api/v1/...`.
  registerMirrorQueueRoutes(app, db, opts.usePrismaAuth && prisma ? prisma : undefined, blobStore)
  // Event-stream ingest + user-owned controls hardcode `/api/v1/...`.
  registerEventRoutes(app, opts.usePrismaAuth && prisma ? prisma : undefined)
  // Cross-vendor distribution (availability) ingest + the viewer's own view.
  registerAvailabilityRoutes(
    app,
    opts.usePrismaAuth && prisma ? prisma : undefined,
  )

  const adapterOpts: AdapterRoutesOptions = opts.adapterSigningKeyHex
    ? { adapterSigningKeyHex: opts.adapterSigningKeyHex }
    : {}

  // Build the avatar store lazily on first upload: the server must boot without
  // R2_AVATARS_* config (tests, CI, blob-less local runs), and only an actual
  // avatar upload requires it. Tests inject a fake via opts.avatarStore.
  let avatarStoreSingleton: AvatarStore | null = opts.avatarStore ?? null
  const getAvatarStore = (): AvatarStore => {
    if (!avatarStoreSingleton) {
      avatarStoreSingleton = new AvatarStore(avatarStoreConfigFromEnv())
    }
    return avatarStoreSingleton
  }

  const mount = async (instance: FastifyInstance): Promise<void> => {
    registerProfileRoutes(instance, {
      getAvatarStore,
      prisma: opts.usePrismaAuth && prisma ? prisma : undefined,
    })
    // `scanSync` is an opts pass-through so tests can flip the
    // async scan to deterministic-sync mode without standing up timers.
    registerSkillRoutes(instance, db, blobStore, {
      scanSync: opts.scanSync,
      prisma: opts.usePrismaAuth && prisma ? prisma : undefined,
    })
    // Abuse report intake → private admin queue.
    registerReportRoutes(
      instance,
      db,
      opts.usePrismaAuth && prisma ? prisma : undefined,
    )
    // Public moderation log: currently-active enforcement.
    registerModerationRoutes(instance, opts.usePrismaAuth && prisma ? prisma : undefined)
    registerKitRoutes(instance, opts.usePrismaAuth && prisma ? prisma : undefined)
    registerSyncRoutes(
      instance,
      db,
      blobStore,
      opts.usePrismaAuth && prisma ? prisma : undefined,
    )
    // §10 signed adapter manifest feed.
    registerAdapterRoutes(instance, adapterOpts)
    registerProposalRoutes(instance, db, blobStore, {
      scanSync: opts.scanSync,
      prisma: opts.usePrismaAuth && prisma ? prisma : undefined,
    })
    // Trust graph: follow / feed.
    registerFollowRoutes(instance, opts.usePrismaAuth && prisma ? prisma : undefined)
    // Inbound activity about you (followers, kit/author subscriptions).
    registerNotificationRoutes(instance, opts.usePrismaAuth && prisma ? prisma : undefined)
    registerAttentionStreamRoutes(
      instance,
      db,
      opts.usePrismaAuth && prisma ? prisma : undefined,
    )
    // Account update mode + account-scoped update decisions (App Store for skills).
    registerAccountRoutes(
      instance,
      opts.usePrismaAuth && prisma ? prisma : undefined,
    )
    registerApprovalRoutes(instance, db, opts.usePrismaAuth && prisma ? prisma : undefined)
    // Discover hub: public kit + people catalogs alongside GET /skills.
    registerDiscoverRoutes(instance, opts.usePrismaAuth && prisma ? prisma : undefined)
    // Public registry-wide aggregates for the /stats page.
    registerStatsRoutes(instance, opts.usePrismaAuth && prisma ? prisma : undefined)
    // Universal search across skills, kits, authors, teams.
    registerSearchRoutes(instance, opts.usePrismaAuth && prisma ? prisma : undefined)
  }

  await app.register(mount, { prefix: REGISTRY_VERSION_PREFIX })

  return { app, db, blobStore }
}
