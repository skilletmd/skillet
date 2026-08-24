// Personal MCP link — fetch, enable, disable, regenerate (R6/R7/R8) — and the
// hosted serving endpoint (U3).
//
//   GET  /api/v1/mcp/link            → the user's link, READ ONLY (never mints)
//   POST /api/v1/mcp/link/enable     → turn MCP on: mint if off, else return the live link
//   POST /api/v1/mcp/link/disable    → turn MCP off: revoke the active link, no re-mint
//   POST /api/v1/mcp/link/regenerate → revoke the active link + mint a new one (rotate)
//   POST /api/v1/mcp/:token          → JSON-RPC MCP endpoint (token in URL)
//   POST /api/v1/mcp                 → same, token via `Authorization: Bearer`
//
// MCP is OFF by default: a link exists only after the user explicitly enables
// it. "enabled" = exactly one mcp_links row with revoked_at IS NULL; "disabled"
// = none. No DB migration — the state is the row's presence.
//
// The link embeds a `skillet_m_` token in its URL, so unlike every other token
// class it must be RE-VIEWABLE from settings (R6). Lookup still goes through
// sha256(token_hash) like the rest of auth; the secret is additionally kept
// AES-256-GCM-encrypted under SKILLET_MCP_TOKEN_KEY (same construction as
// sync/repo-auth.ts under SKILLET_REPO_TOKEN_KEY) so GET can decrypt and
// re-show it. Plaintext is never stored. Missing key → fail closed: the routes
// refuse to mint or read rather than falling back to a source-readable key.
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { DatabaseSync } from '../db/sqlite-handle.js';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { handleMessage, parseMessage } from '@skillet/mcp';
import { bearerChallenge } from '@skillet/protocol/protected-resource';
import { tryToSkillId, toWireRef } from '@skillet/protocol/skill-id';
import { mintToken, parseBearer } from '../auth/tokens.js';
import { requireUser, type Principal } from '../auth/middleware.js';
import { accountUserId } from './account.js';
import { checkMcpRateLimitPrisma } from '../ratelimit/mcp.js';
import type { BlobStore } from '../blob-store/types.js';
import { enableMcpLinkPrisma, findActiveMcpLinkPrisma, listMcpLinkClientsPrisma, regenerateMcpLinkPrisma, resolveServeAuthPrisma, revokeActiveMcpLinksPrisma, upsertMcpLinkClientPrisma, } from '../lib/mcp-links.js';
import { createRegistrySkillSourcePrisma } from '../mcp/registry-source-prisma.js';
import { createRegistryDiscoveryPrisma } from '../mcp/discovery-prisma.js';
import { recordMcpSkillUsagePrisma } from '../mcp/record-usage.js';
function encryptionKey(): Buffer {
    const secret = process.env.SKILLET_MCP_TOKEN_KEY ?? '';
    if (!secret) {
        // Fail CLOSED on a missing key — the deterministic dev fallback is
        // reachable ONLY under the explicit dev-auth gate (SKILLET_ENABLE_DEV_AUTH=1),
        // never on NODE_ENV alone. Mirrors sync/repo-auth.ts.
        if (process.env.SKILLET_ENABLE_DEV_AUTH === '1') {
            // Dev convenience only — deterministic so restarts can still decrypt.
            return scryptSync('skillet-dev-mcp-token-key', 'skillet-mcp-salt', 32);
        }
        throw new Error('SKILLET_MCP_TOKEN_KEY is required to store MCP link tokens');
    }
    return scryptSync(secret, 'skillet-mcp-salt', 32);
}
function mcpKeyConfigured(): boolean {
    return Boolean(process.env.SKILLET_MCP_TOKEN_KEY) || process.env.SKILLET_ENABLE_DEV_AUTH === '1';
}
/** AES-256-GCM → base64(iv | authTag | ciphertext). */
function encryptToken(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
}
function decryptToken(enc: string): string {
    const buf = Buffer.from(enc, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
/**
 * Public base of THIS registry, for composing the link URL. Deployments set
 * SKILLET_REGISTRY_PUBLIC_URL (the canonical externally-reachable origin);
 * otherwise we fall back to the request's own protocol + Host header, which is
 * correct for direct exposure and for proxies that preserve Host.
 */
function registryBase(req: FastifyRequest): string {
    const configured = process.env.SKILLET_REGISTRY_PUBLIC_URL;
    const base = configured ?? `${req.protocol}://${req.headers.host ?? 'localhost'}`;
    return base.replace(/\/+$/, '');
}
function linkUrl(req: FastifyRequest, token: string): string {
    return `${registryBase(req)}/api/v1/mcp/${token}`;
}
/** 201 body for a freshly minted link (enable / regenerate) — unused by definition. */
function mintedLinkBody(req: FastifyRequest, secret: string, now: number): {
    enabled: true;
    url: string;
    token: string;
    created_at: number;
    last_used_at: null;
    clients: [
    ];
} {
    return {
        enabled: true,
        url: linkUrl(req, secret),
        token: secret,
        created_at: now,
        last_used_at: null,
        clients: [],
    };
}
async function sendKeyUnconfigured(reply: FastifyReply): Promise<void> {
    await reply.code(503).send({
        error: 'mcp_key_unconfigured',
        message: 'This registry has no SKILLET_MCP_TOKEN_KEY configured, so MCP links cannot be minted or read.',
    });
}
/**
 * Rotated/mis-set SKILLET_MCP_TOKEN_KEY: the stored secret exists but can no
 * longer be decrypted. Distinct from `mcp_key_unconfigured` so settings can
 * tell "MCP is not offered here" (hide the section) from "your link exists but
 * the registry can't read it right now" (show the notice).
 */
async function sendKeyUndecryptable(reply: FastifyReply): Promise<void> {
    await reply.code(503).send({
        error: 'mcp_key_undecryptable',
        message: 'This registry’s SKILLET_MCP_TOKEN_KEY cannot decrypt the stored MCP link token — the key was rotated or mis-set.',
    });
}
// ── Hosted serving endpoint (U3) ─────────────────────────────────────────────
/**
 * JSON-RPC methods this endpoint answers WITHOUT a token.
 *
 * All four are pure protocol: they describe the server, not the caller's kit.
 * `initialize` returns capabilities and serverInfo, `ping` returns `{}`,
 * `tools/list` returns a fixed tool table that is already published verbatim at
 * `/.well-known/mcp.json`, and `notifications/initialized` has no body at all.
 * Nothing here reads a user's skills — `tools/call`, `resources/list`, and
 * `resources/read` all do, and all still require the link token.
 *
 * Why open them: the MCP handshake is how a client discovers a server exists.
 * A `401` on `initialize` reads to every client (and every audit) as "this
 * server is broken", not "you need a token" — so Skillet's hosted server
 * looked dead to anything that had not already been handed a link. Answering
 * the handshake and then challenging on the first real call is both the MCP
 * authorization spec's flow and the one that tells the truth.
 */
const PUBLIC_MCP_METHODS: ReadonlySet<string> = new Set([
    'initialize',
    'notifications/initialized',
    'ping',
    'tools/list',
]);
/**
 * 401 body for the serving endpoint. Mirrors authRequiredBody's tone: say
 * what happened and the one step out. NEVER includes the presented token or
 * any kit/skill metadata — the caller is unauthenticated by definition.
 */
function mcpAuthFailedBody(reason: 'invalid' | 'suspended'): {
    error: 'auth_required';
    message: string;
} {
    const webUrl = (process.env.SKILLET_WEB_URL ?? 'https://skillet.md').replace(/\/+$/, '');
    if (reason === 'suspended') {
        return {
            error: 'auth_required',
            message: 'This account is suspended, so its MCP link is disabled. ' +
                `See ${webUrl} for moderation status.`,
        };
    }
    return {
        error: 'auth_required',
        message: 'This MCP link is not valid — it may have been regenerated or revoked. ' +
            `Open ${webUrl} → Settings → Account and reconnect with your current link.`,
    };
}
/**
 * Canonical client key from the MCP `initialize` handshake (clientInfo.name).
 * Known clients map onto the runtime keys the web renders glyphs for; anything
 * else is slugged and kept, capped so junk names can't bloat the column.
 */
function normalizeMcpClientName(raw: unknown): string | null {
    if (typeof raw !== 'string')
        return null;
    const s = raw.toLowerCase().trim();
    if (!s)
        return null;
    if (s.includes('chatgpt') || s.includes('openai'))
        return 'chatgpt';
    if (s.includes('claude') || s.includes('anthropic'))
        return 'claude-ai';
    const slug = s
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
    return slug || null;
}
/** UA fallback for clients whose initialize we never saw (or that omit
 * clientInfo). Known vendors only — arbitrary UA strings are noise. */
function mcpClientFromUserAgent(ua: unknown): string | null {
    if (typeof ua !== 'string')
        return null;
    const s = ua.toLowerCase();
    if (s.includes('chatgpt') || s.includes('openai'))
        return 'chatgpt';
    if (s.includes('claude') || s.includes('anthropic'))
        return 'claude-ai';
    return null;
}
/**
 * Record which client is talking to a link. Fires on the connect-time methods
 * (`initialize` and `tools/list`), never on the per-call `tools/call` hot path,
 * so writes stay ~once-per-connect. Powers the settings row's usage-attributed
 * glyphs.
 *
 * `initialize` is where current-spec clients name themselves (params.clientInfo).
 * We also fire on `tools/list` because the 2026-07-28 stateless model drops the
 * `initialize` handshake — a stateless client's first contact is a plain
 * request, so without this its usage would go unattributed. On those we can
 * still recover the vendor from `_meta.clientInfo` (where stateless clients
 * carry it) or the User-Agent. Unknown clients record nothing either way.
 */
function mcpClientFromMessage(msg: unknown, userAgent: unknown): string | null {
    const m = msg as {
        method?: string;
        params?: {
            clientInfo?: {
                name?: unknown;
            };
            _meta?: {
                clientInfo?: {
                    name?: unknown;
                };
            };
        };
    };
    if (m?.method !== 'initialize' && m?.method !== 'tools/list')
        return null;
    const named = m.params?.clientInfo?.name ?? m.params?._meta?.clientInfo?.name;
    return normalizeMcpClientName(named) ?? mcpClientFromUserAgent(userAgent);
}
async function recordMcpClientPrisma(prisma: PrismaClient, linkId: string, msg: unknown, userAgent: unknown): Promise<void> {
    const client = mcpClientFromMessage(msg, userAgent);
    if (!client)
        return;
    const now = Math.floor(Date.now() / 1000);
    await upsertMcpLinkClientPrisma(prisma, linkId, client, now);
}
/**
 * Route-level log redaction: the capability token rides in the URL, so the
 * default `req` serializer would write it to every "incoming request" line.
 * Replace the path segment after /mcp/ wholesale (not just well-formed
 * tokens) so no presented credential shape ever reaches the log stream.
 */
function redactMcpUrl(url: string): string {
    return url.replace(/(\/mcp\/)[^/?#]+/g, '$1[redacted]');
}
function redactedReqSerializer(req: {
    method?: string;
    url?: string;
}): {
    method: string | undefined;
    url: string;
} {
    return { method: req?.method, url: redactMcpUrl(req?.url ?? '') };
}
/** JSON-RPC `tools/call` result shape this file reads back to record usage. */
type McpToolResult = {
    isError?: boolean;
    structuredContent?: unknown;
};
/** `@owner/slug` wire ref via the shared skill-id grammar, or null if invalid. */
function canonicalRef(owner: string, slug: string): string | null {
    // The registry source can advertise a collision-qualified slug (`owner/slug`)
    // — take the bare tail so the ref never becomes `@owner/owner/slug`.
    const id = tryToSkillId(`${owner}/${slug.split('/').pop()}`);
    return id ? toWireRef(id) : null;
}
/**
 * Canonical `@owner/slug` ref for a skill-load tools/call, or null when the call
 * isn't a successful load. Only `get_skill`/`fetch` (a SKILL.md load) count —
 * `list_skills`/`search`/`search_skills` are browsing, and supporting files go
 * through `resources/read`, never here.
 */
function deriveMcpSkillRef(toolName: string | undefined, args: {
    id?: unknown;
} | undefined, result: McpToolResult | undefined): string | null {
    if (!result || result.isError)
        return null;
    if (toolName === 'get_skill') {
        const sc = result.structuredContent as {
            author?: unknown;
            slug?: unknown;
        } | undefined;
        const author = typeof sc?.author === 'string' ? sc.author : null;
        const slug = typeof sc?.slug === 'string' ? sc.slug : null;
        if (!author || !slug)
            return null;
        return canonicalRef(author, slug);
    }
    if (toolName === 'fetch') {
        // The deep-research id is `owner/slug` (or `owner/owner/slug` for a
        // collision entry) — the last two segments are the owner and bare slug.
        const id = typeof args?.id === 'string' ? args.id : null;
        const segs = id ? id.split('/').filter(Boolean) : [];
        if (segs.length < 2)
            return null;
        return canonicalRef(segs[segs.length - 2]!, segs[segs.length - 1]!);
    }
    return null;
}
const MCP_ALLOW = 'POST, HEAD, OPTIONS';

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerMcpRoutes(app: FastifyInstance, db: DatabaseSync, blobStore: BlobStore, prismaArg?: PrismaClient): void {
    const prisma = requirePrisma(
      prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
    )
    type ActiveLinkState = {
        state: 'enabled';
        body: {
            enabled: true;
            url: string;
            token: string;
            created_at: number;
            last_used_at: number | null;
            clients: Array<{
                client: string;
                last_used_at: number;
            }>;
        };
    } | {
        state: 'disabled';
    } | {
        state: 'undecryptable';
    };
    function decodeActiveLink(req: FastifyRequest, active: {
        id: string;
        token_secret_enc: string;
        created_at: number;
        last_used_at: number | null;
    }, clients: Array<{
        client: string;
        last_used_at: number;
    }>): ActiveLinkState {
        let token: string;
        try {
            token = decryptToken(active.token_secret_enc);
        }
        catch {
            // A rotated/mis-set SKILLET_MCP_TOKEN_KEY can no longer decrypt the
            // stored secret. Surface a typed 503 distinct from the missing-key path
            // (settings shows its notice instead of hiding the section) rather than
            // an opaque 500 — and never auto-regenerate: a transient key misconfig
            // must not silently rotate a live token.
            return { state: 'undecryptable' };
        }
        return {
            state: 'enabled',
            body: {
                enabled: true,
                url: linkUrl(req, token),
                token,
                created_at: active.created_at,
                last_used_at: active.last_used_at ?? null,
                clients,
            },
        };
    }
    // Read the caller's active link. Shared by GET (read-only) and enable's
    // idempotent branch. Returns the enabled body, `null` if MCP is off, or a
    // typed 503 sender if the stored secret can no longer be decrypted.
    async function readActiveLinkPrisma(req: FastifyRequest, userId: string): Promise<ActiveLinkState> {
        if (!prisma)
            return { state: 'disabled' };
        const active = await findActiveMcpLinkPrisma(prisma, userId);
        if (!active)
            return { state: 'disabled' };
        const clients = await listMcpLinkClientsPrisma(prisma, active.id);
        return decodeActiveLink(req, active, clients);
    }
    // The user's personal MCP link — READ ONLY. MCP is off by default; this never
    // mints. Off → `{ enabled: false }`; on → the link. The token exists only
    // after an explicit enable (R6).
    app.get('/api/v1/mcp/link', { preHandler: requireUser() }, async (req, reply) => {
        if (!mcpKeyConfigured())
            return sendKeyUnconfigured(reply);
        const userId = accountUserId(req.principal as Principal);
        const active = await readActiveLinkPrisma(req, userId);
        if (active.state === 'undecryptable')
            return sendKeyUndecryptable(reply);
        if (active.state === 'disabled')
            return reply.code(200).send({ enabled: false });
        return reply.code(200).send(active.body);
    });
    // Enable: turn MCP on. Idempotent — if a live link already exists, decrypt
    // and return it (200); otherwise mint one in a transaction (201). The
    // transaction is the single-writer path, so it also closes the prior
    // lazy-mint SELECT-then-INSERT race.
    app.post('/api/v1/mcp/link/enable', { preHandler: requireUser() }, async (req, reply) => {
        if (!mcpKeyConfigured())
            return sendKeyUnconfigured(reply);
        const userId = accountUserId(req.principal as Principal);
        const active = await readActiveLinkPrisma(req, userId);
        if (active.state === 'undecryptable')
            return sendKeyUndecryptable(reply);
        if (active.state === 'enabled')
            return reply.code(200).send(active.body);
        const { secret, hash } = mintToken('mcp');
        const now = Math.floor(Date.now() / 1000);
        await enableMcpLinkPrisma(prisma, userId, encryptToken(secret), hash, now);
        const after = await readActiveLinkPrisma(req, userId);
        if (after.state === 'undecryptable')
            return sendKeyUndecryptable(reply);
        if (after.state === 'enabled' && after.body.token !== secret) {
            return reply.code(200).send(after.body);
        }
        return reply.code(201).send(mintedLinkBody(req, secret, now));
    });
    // Disable: turn MCP off. Revoke the active link and do NOT re-mint. Idempotent
    // — no active row still returns 200 { enabled: false }. Revoking must always
    // work, so this does NOT require SKILLET_MCP_TOKEN_KEY.
    app.post('/api/v1/mcp/link/disable', { preHandler: requireUser() }, async (req, reply) => {
        const userId = accountUserId(req.principal as Principal);
        const now = Math.floor(Date.now() / 1000);
        await revokeActiveMcpLinksPrisma(prisma, userId, now);
        return reply.code(200).send({ enabled: false });
    });
    // Regenerate: revoke the active link and mint its replacement in ONE
    // transaction, so the old token dies the instant the new one exists (R8)
    // and the user is never left link-less between the two writes.
    app.post('/api/v1/mcp/link/regenerate', { preHandler: requireUser() }, async (req, reply) => {
        if (!mcpKeyConfigured())
            return sendKeyUnconfigured(reply);
        const userId = accountUserId(req.principal as Principal);
        const { secret, hash } = mintToken('mcp');
        const now = Math.floor(Date.now() / 1000);
        await regenerateMcpLinkPrisma(prisma, userId, encryptToken(secret), hash, now);
        return reply.code(201).send(mintedLinkBody(req, secret, now));
    });
    // ── Hosted MCP serving endpoint ────────────────────────────────────────────
    //
    // POST /api/v1/mcp/:token  (token in the URL — the personal link)
    // POST /api/v1/mcp         (token via `Authorization: Bearer skillet_m_…`)
    //
    // Serves the link owner's approved kit over JSON-RPC, multi-tenant, straight
    // from registry storage. Auth is the endpoint's own gate (see
    // resolveServeAuth); visibility is the per-user source built per request —
    // `httpAuthorized: true` is scoped to exactly that source.
    /**
     * Answer an anonymous request if — and only if — it is one of the four
     * protocol methods in PUBLIC_MCP_METHODS.
     *
     * Returns the JSON-RPC response, `null` for an accepted notification, or
     * `undefined` to mean "not public, challenge it". No `source` is passed:
     * these methods never touch one, and handing them an empty source would
     * make a kit-reading method silently answer "you have no skills" instead of
     * "you are not authenticated".
     */
    const handlePublicMcpMessage = async (req: FastifyRequest): Promise<unknown | null | undefined> => {
        let msg;
        try {
            const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
            msg = parseMessage(rawBody);
        }
        catch {
            return undefined;
        }
        const method = (msg as { method?: string }).method;
        if (!method || !PUBLIC_MCP_METHODS.has(method)) return undefined;
        return handleMessage(msg, {
            deepResearchAliases: true,
            // initialize and tools/list are the two methods that DESCRIBE the
            // server, so the unauthenticated probe must see the same tool list
            // the authenticated caller gets. Anonymous principal: tools/call is
            // not public, so nothing here can be invoked without a bearer.
            discovery: createRegistryDiscoveryPrisma(prisma, blobStore, { principal: null }),
            serverVersion: process.env.SKILLET_REGISTRY_VERSION,
        });
    };
    const serveHandler = async (req: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
        if (req.method === 'OPTIONS') {
            return reply.code(204).header('allow', MCP_ALLOW).send();
        }
        if (req.method === 'HEAD') {
            return reply.code(200).send();
        }
        if (req.method !== 'POST') {
            return reply.code(405).header('allow', MCP_ALLOW).send({
                error: 'method_not_allowed',
                message: 'The Skillet MCP endpoint speaks JSON-RPC over POST.',
            });
        }
        const params = req.params as {
            token?: string;
        };
        const rawToken = params.token ?? parseBearer(req.headers.authorization);
        const auth = await resolveServeAuthPrisma(prisma, rawToken);
        if (!auth.ok) {
            // Unauthenticated: answer the protocol handshake, challenge on
            // anything that would read a kit. RFC 6750 §3 + RFC 9728 §5.1 —
            // `resource_metadata` is how an MCP client discovers where to get a
            // credential instead of guessing.
            reply.header('WWW-Authenticate', bearerChallenge('mcp', {
                siteUrl: (process.env.SKILLET_WEB_URL ?? 'https://skillet.md').replace(/\/+$/, ''),
                registryUrl: registryBase(req),
            }, rawToken ? 'invalid_token' : 'invalid_request'));
            const publicResponse = await handlePublicMcpMessage(req);
            if (publicResponse === undefined) {
                return reply.code(401).send(mcpAuthFailedBody(auth.reason));
            }
            // The challenge stays on the handshake response too: a client that
            // reads ahead learns where its token comes from before it needs one.
            if (publicResponse === null) return reply.code(202).send();
            return reply.code(200).send(publicResponse);
        }
        // Abuse throttle (U4) — after auth so the PRIMARY bucket keys on the
        // resolved mcp_link id (connector traffic shares egress IPs; see
        // ratelimit/mcp.ts). The serving routes only — link mint/regenerate are
        // session-gated and already covered by the global HTTP limits. The 429
        // body names nothing sensitive: no token, no kit/skill metadata.
        const verdict = await checkMcpRateLimitPrisma(prisma, auth.linkId, req.ip || 'unknown');
        if (verdict.limited) {
            if (verdict.scope !== 'token') {
                req.log.warn({ scope: verdict.scope, limit: verdict.limit }, 'mcp shared rate backstop tripped — possible scraping/flood; investigate');
            }
            reply.header('Retry-After', String(verdict.retryAfterSeconds));
            return reply.code(429).send({
                error: 'rate_limited',
                scope: verdict.scope,
                limit: verdict.limit,
                retry_after_seconds: verdict.retryAfterSeconds,
                message: 'This MCP endpoint is receiving too many requests. ' +
                    `Wait ${verdict.retryAfterSeconds}s and retry.`,
            });
        }
        // Fastify already parsed application/json bodies; parseMessage re-checks
        // the JSON-RPC envelope shape either way.
        let msg;
        try {
            const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body ?? null);
            msg = parseMessage(rawBody);
        }
        catch (e) {
            // 400 for a malformed envelope — same status the standalone HTTP
            // transport (packages/mcp transport/http.ts) returns for this failure.
            const code = (e as {
                jsonrpcCode?: number;
            }).jsonrpcCode ?? -32700;
            return reply.code(400).send({
                jsonrpc: '2.0',
                id: null,
                error: { code, message: e instanceof Error ? e.message : 'Parse error' },
            });
        }
        await recordMcpClientPrisma(prisma, auth.linkId, msg, req.headers['user-agent']);
        // One structured line per tools/call: link id, tool, slug — never
        // arguments, query text, or anything conversational.
        const asCall = msg as {
            method?: string;
            params?: {
                name?: string;
                arguments?: unknown;
            };
        };
        if (asCall.method === 'tools/call') {
            const args = asCall.params?.arguments as {
                slug?: unknown;
            } | undefined;
            req.log.info({
                mcp_link_id: auth.linkId,
                tool: asCall.params?.name ?? null,
                slug: typeof args?.slug === 'string' ? args.slug : null,
            }, 'mcp_tool_call');
        }
        const source = createRegistrySkillSourcePrisma(prisma, blobStore, {
            userId: auth.userId,
            handle: auth.handle,
            principal: auth.principal,
        });
        // handleMessage never throws: handler/source failures (blob miss, guard
        // block) come back as JSON-RPC `error` bodies, so nothing here can fall
        // through to Fastify's opaque global 500.
        const rpcResponse = await handleMessage(msg, {
            source,
            // Summon: reaching PUBLIC skills beyond this caller's kit. Hosted
            // only — the loopback server passes none and advertises no summon
            // tools, so `skillet mcp` stays offline-capable.
            discovery: createRegistryDiscoveryPrisma(prisma, blobStore, {
                principal: auth.principal,
            }),
            httpAuthorized: true,
            // Hosted surface carries the ChatGPT deep-research aliases (search/fetch)
            // on top of the three core tools; the local stdio server never sets this.
            deepResearchAliases: true,
            // The registry has no package-release cadence — its identity is the
            // deploy. Surface that when the deploy sets it; otherwise the server
            // falls back to its static default.
            serverVersion: process.env.SKILLET_REGISTRY_VERSION,
        });
        if (rpcResponse === null) {
            // Valid notification — acknowledged, no body.
            return reply.code(202).send();
        }
        // Record a skill load as a usage event so MCP-applied skills show up in the
        // owner's route-usage alongside CLI routes. Only successful get_skill/fetch
        // loads count; a recording failure must never affect the RPC response.
        if (asCall.method === 'tools/call') {
            const toolName = asCall.params?.name;
            if (toolName === 'get_skill' || toolName === 'fetch') {
                try {
                    const result = (rpcResponse as {
                        result?: McpToolResult;
                    }).result;
                    const skillRef = deriveMcpSkillRef(toolName, asCall.params?.arguments as {
                        id?: unknown;
                    } | undefined, result);
                    if (skillRef) {
                        await recordMcpSkillUsagePrisma(prisma, {
                            linkId: auth.linkId,
                            userId: auth.userId,
                            skillRef,
                        });
                    }
                }
                catch (e) {
                    req.log.warn({ err: e, mcp_link_id: auth.linkId }, 'mcp usage recording failed');
                }
            }
        }
        return reply.code(200).send(rpcResponse);
    };
    for (const url of ['/api/v1/mcp', '/api/v1/mcp/:token']) {
        app.route({
            method: ['GET', 'POST', 'HEAD', 'OPTIONS'],
            url,
            // HEAD is handled explicitly above; stop Fastify pairing one to GET.
            exposeHeadRoute: false,
            // The token never reaches the log stream (see redactMcpUrl): this
            // route's child logger swaps in a redacting `req` serializer, so the
            // auto "incoming request" line and anything else that serializes the
            // request carries a masked URL. Applies to the bare /api/v1/mcp route
            // too — harmless there, consistent everywhere.
            childLoggerFactory(logger, bindings, opts) {
                return logger.child(bindings, {
                    ...opts,
                    serializers: { ...opts?.serializers, req: redactedReqSerializer },
                });
            },
            handler: serveHandler,
        });
    }
}
