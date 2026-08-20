import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from '../db/sqlite-handle.js';
import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { SYNC_INTERVAL_SECONDS_DEFAULT, ARTIFACT_SCHEMA_VERSION } from '@skillet/protocol';
import type { SyncManifest, SyncManifestItem } from '@skillet/protocol';
import { serveBlockForScanPrisma, serveBlockForModerationPrisma } from './serve-guards.js';
import { canReadSkillPrisma } from '../auth/skill-read-access.js';
import { authRequiredBody, pairFlowGuidance } from '../auth/middleware.js';
import { verifyBlobBytes } from '../blob-store/verify-bytes.js';
import type { BlobStore } from '../blob-store/types.js';
import { clientBelowFloor, minSupportedVersion, upgradeRequiredBody } from '../lib/min-version.js';
import { pendingRemovalsPrisma } from '../lib/pending-removals.js';
import { buildKitManifestPrisma, buildSessionManifestPrisma, deviceExcludeKeysPrisma } from '../lib/sync-manifest.js';
// Bearer-aware manifest + private-kit content gate.
//
// When SKILLET_REGISTRY_REQUIRE_AUTH_FOR_CONTENT=false, public
// skills pass through for device-class tokens without further auth checks.
// Default is true (all content private) until the visibility column lands.
const REQUIRE_AUTH_FOR_CONTENT = process.env.SKILLET_REGISTRY_REQUIRE_AUTH_FOR_CONTENT !== 'false';
interface ContentParams {
    content_hash: string;
}
// Union of kits owned by the user (via handle) and kits where user is a member.
// Owner-side scanned first so seenRefs dedup gives owner-side priority.
// `excludeKeys` scopes the union to one machine (per-device kit routing): rows
// whose source key is excluded are dropped. Empty set → the full account union.
// Exported for the hosted MCP endpoint (routes/mcp.ts), which serves exactly
// this union — same guards, same dedup — over JSON-RPC.
export function buildSessionManifest(_db: DatabaseSync, _userId: string, _handle: string | null, _excludeKeys: Set<string> = new Set()): SyncManifestItem[] {
    throw new Error("sqlite registry store removed; use the *Prisma counterpart: buildSessionManifestPrisma");
}
function computeEtag(items: SyncManifestItem[], holdRefs: string[] = []): string {
    const h = createHash('sha256');
    for (const item of items) {
        h.update(item.ref);
        h.update('\0');
        h.update(item.content_hash);
        h.update('\0');
        h.update(String(item.version));
        h.update('\0');
        h.update(item.policy);
        h.update('\0');
    }
    // Undecided kit removals (R5) are part of the reconcile input even though
    // they are absent from the item list: the device HOLDS them from pruning.
    // Deciding one changes no manifest item, so without this the ETag stays
    // identical, the device keeps getting 304, and the released hold is never
    // reconciled — the pruned skill would linger on disk forever.
    for (const ref of [...holdRefs].sort()) {
        h.update('hold:');
        h.update(ref);
        h.update('\0');
    }
    return `sha256:${h.digest('hex')}`;
}
function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
    if (!prisma) {
        throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
    }
    return prisma;
}
export function registerSyncRoutes(app: FastifyInstance, db: DatabaseSync, blobStore: BlobStore, prismaArg?: PrismaClient): void {
    const prisma = requirePrisma(prismaArg ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined));
    // GET /sync/manifest — Bearer-aware union manifest.
    // Replaces the ?owner= stub. Token class determines what is returned:
    //   session  → union of owned kits + member kits
    //   kit      → only the bound kit's items
    //   device   → session-equivalent union for the bound user (devices are
    //              always account-bound; an unbound row fails closed with 403)
    //   no token → 401 auth_required
    app.get<{
        Querystring: {
            device?: string;
        };
    }>('/sync/manifest', async (req, reply) => {
        // Minimum-supported-version gate (dormant at floor 0.0.0). Fires before auth
        // so an out-of-date client gets the actionable "please update" signal rather
        // than a generic 401. Fail-open on missing/garbled versions.
        const clientVersion = req.headers['x-skillet-client-version'] as string | undefined;
        if (clientBelowFloor(clientVersion)) {
            return reply.status(426).send(upgradeRequiredBody(minSupportedVersion()));
        }
        const principal = req.principal;
        if (!principal) {
            return reply.status(401).send(authRequiredBody(req));
        }
        let items: SyncManifestItem[];
        if (principal.class === 'session') {
            const excludeKeys = await deviceExcludeKeysPrisma(prisma, req.query.device ?? null, principal.user_id);
            items = await buildSessionManifestPrisma(prisma, principal.user_id, principal.handle, excludeKeys);
        }
        else if (principal.class === 'kit') {
            items = await buildKitManifestPrisma(prisma, principal.kit_id);
        }
        else if (principal.class === 'mcp') {
            // MCP links are read-only (R7) and carry no `sync` scope — they read
            // skills through the hosted MCP endpoint, never the sync surface.
            return reply.status(403).send({
                error: 'wrong_token_class',
                required: 'session',
                got: principal.class,
            });
        }
        else {
            // Device class — always bound to a user. A null user_id row should be
            // impossible (schema enforces NOT NULL after the U6 migration) but stays
            // constructible out-of-band until then; fail CLOSED with the pair-flow
            // signpost rather than serving a manifest for nobody. NEVER coerce the
            // null to '' to satisfy buildSessionManifest — that would fabricate an
            // empty "user" manifest and trigger a client zero-out.
            if (principal.user_id === null) {
                return reply.status(403).send({
                    error: 'device_not_paired',
                    message: pairFlowGuidance(),
                });
            }
            const userRow = await prisma.users.findUnique({
                where: { id: principal.user_id },
                select: { handle: true },
            });
            const excludeKeys = await deviceExcludeKeysPrisma(prisma, principal.device_id, principal.user_id);
            items = await buildSessionManifestPrisma(prisma, principal.user_id, userRow?.handle ?? null, excludeKeys);
        }
        // R5: user-bound manifests fold the undecided-removal set into the ETag,
        // so deciding a removal (which changes no item) still busts the 304 path
        // and the next sync reconciles the released hold.
        const holdUserId =
            principal.class === 'session' || principal.class === 'device'
                ? principal.user_id
                : null;
        const holdRefs = holdUserId
            ? (await pendingRemovalsPrisma(prisma, holdUserId)).map((r) => r.skill_id as string)
            : [];
        const etag = computeEtag(items, holdRefs);
        if (req.headers['if-none-match'] === `"${etag}"`) {
            reply.header('ETag', `"${etag}"`);
            return reply.status(304).send();
        }
        const body: SyncManifest = {
            schema_version: ARTIFACT_SCHEMA_VERSION,
            etag,
            sync_interval_seconds: SYNC_INTERVAL_SECONDS_DEFAULT,
            // Every manifest is account-bound now: an empty items list is always a
            // real "sync nothing here" (the 'anonymous' scope died with /signup).
            account_scope: 'user',
            items,
        };
        reply.header('ETag', `"${etag}"`);
        // Per-user sync manifest -> `private, no-store`: a shared cache must
        // never retain one user's device manifest (#468).
        reply.header('Cache-Control', 'private, no-store');
        return reply.status(200).send(body);
    });
    // GET /sync/content/{content_hash} — raw bundle by canonical hash.
    // Bearer-aware private-kit gate. Unauthorized → 404 (not 403) so
    // private-kit existence is not probeable.
    app.get<{
        Params: ContentParams;
    }>('/sync/content/:content_hash', async (req, reply) => {
        const param = req.params.content_hash;
        // canonicalContentHash() stores hashes with the 'sha256:' prefix; normalise
        // so both 'sha256:<hex>' and bare '<hex>' params resolve correctly.
        const fullHash = param.startsWith('sha256:') ? param : `sha256:${param}`;
        const rawHash = param.startsWith('sha256:') ? param.slice('sha256:'.length) : param;
        const principal = req.principal;
        if (!principal && REQUIRE_AUTH_FOR_CONTENT) {
            return reply.status(401).send(authRequiredBody(req));
        }
        const ver = await prisma.skill_versions.findFirst({
            where: { hash: fullHash },
            select: {
                metadata_json: true,
                published_at: true,
                published_by: true,
                skill_id: true,
                yanked_at: true,
            },
        });
        if (!ver) {
            return reply.status(404).send({ error: 'content_hash not found' });
        }
        const skillMd = await prisma.skill_version_files.findFirst({
            where: { skill_id: ver.skill_id, version_hash: fullHash, path: 'SKILL.md' },
            select: { blob_hash: true },
        });
        const skillRow = await prisma.skills.findUnique({
            where: { id: ver.skill_id },
            select: { visibility: true },
        });
        if (!skillRow ||
            !(await canReadSkillPrisma(prisma, principal, ver.skill_id, skillRow.visibility))) {
            return reply.status(404).send({ error: 'content_hash not found' });
        }
        if (ver.yanked_at) {
            return reply.status(404).send({ error: 'content_hash not found' });
        }
        const modBlock = await serveBlockForModerationPrisma(prisma, ver.skill_id);
        if (modBlock) {
            return reply.status(modBlock.status).send(modBlock.body);
        }
        const scanBlock = await serveBlockForScanPrisma(prisma, fullHash);
        if (scanBlock) {
            return reply.status(scanBlock.status).send(scanBlock.body);
        }
        reply.header('ETag', `"sha256:${rawHash}"`);
        // Raw private SKILL.md bytes -> `private, no-store`; never shared-cache (#468).
        reply.header('Cache-Control', 'private, no-store');
        let content: string | null = null;
        if (skillMd?.blob_hash) {
            const bytes = await blobStore.get(skillMd.blob_hash);
            if (!bytes || !verifyBlobBytes(skillMd.blob_hash, bytes)) {
                return reply.status(500).send({
                    error: 'corrupt_storage',
                    message: `Content hash ${fullHash} failed blob integrity verification`,
                });
            }
            content = Buffer.from(bytes).toString('utf8');
        }
        // Mirror the sqlite response shape from the remainder of this handler.
        return reply.status(200).send({
            schema_version: ARTIFACT_SCHEMA_VERSION,
            content_hash: `sha256:${rawHash}`,
            content,
            metadata: JSON.parse(ver.metadata_json) as unknown,
            published_at: ver.published_at,
            published_by: ver.published_by,
            skill_id: ver.skill_id,
        });
    });
}
