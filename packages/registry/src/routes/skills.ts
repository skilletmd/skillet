import type { FastifyInstance, FastifyReply } from 'fastify';
import type { DatabaseSync } from '../db/sqlite-handle.js';
import { createHash } from 'node:crypto';
import { BundleError, type BundleFiles, bundlePathError, bundleToZip, canonicalContentHash, decodeBundle, encodeBundle, isSkilletBackupPath, stripSkilletBackupPaths, validateBundle, ARTIFACT_SCHEMA_VERSION, INLINE_IMAGE_CONTENT_TYPES, MAX_INLINE_IMAGE_BYTES, inlineImageExtension, isReservedSkillSlug, isValidSkillSlug, isBundleSignatureV2 } from '@skillet/protocol';
import { toSkillId, tryToSkillId, type SkillId } from '@skillet/protocol/skill-id';
import { blobHash } from '../db/index.js';
import { catalogUsedByFacesPrisma, countPublicCatalogSkillsPrisma, listPublicCatalogSkillSummariesPrisma, type CatalogSkillSort } from '../lib/catalog-skills.js';
import { emitSummonEvent } from '../lib/summon-events.js';
import { isAccountBound } from '../auth/account-bound.js';
import { catalogListMemo, catalogListMemoKey } from '../lib/catalog-list-memo.js';
import { setPublicCatalogListCacheHeaders } from '../lib/catalog-list-cache-headers.js';
import { invalidateCatalogCachesAfterPublish } from '../lib/cloudflare-catalog-purge.js';
import type { PrismaDb } from '../db/prisma-client.js';
import { type Signature } from '../auth/signature.js';
import { nextVersionOrdinalPrisma } from '../lib/version-ordinal.js';
import { resolveAndVerifySignerPrisma } from '../auth/delegation.js';
import { isSessionPublishAuth, PUBLISH_AUTH_SESSION, sessionSignatureEnvelope, wireSignatureFromVersionRow } from '../auth/session-publish.js';
import { requireScope } from '../auth/middleware.js';
import { recordSkillInstallPrisma, autoFollowAuthorOnInstallPrisma } from './skill-install.js';
import { requirePublishRateLimit } from '../ratelimit/publish.js';
import { MAX_PAGE_OFFSET } from '../lib/pagination.js';
import { getScanInfoPrisma, getScanCacheStatsPrisma, getScanReportPrisma, scanBundleCachedPrisma, resolveScanCachedPrisma, secretsBlockingScan, CAPABILITY_VERSION, DETECTOR_CORPUS_VERSION } from '../scanner/index.js';
import type { ScanInfo } from '../scanner/index.js';
import type { BlobStore } from '../blob-store/types.js';
import { loadBundleForVersionPrisma, putFileBlobs, listVersionFileRowsPrisma, loadFileForVersionPrisma } from '../blob-store/index.js';
import { fileMetaFromBytes, fileMetaFromPathAndSize, normalizeBundleFilePath } from '../lib/bundle-file-meta.js';
import { renderUnifiedDiff } from '../lib/diff.js';
import { isTextFile, decodeText } from '../scanner/text-files.js';
import { toSkillSummary } from './skill-summary.js';
import { parseCategoryFilter, isCategoryKey } from '../categories.js';
import { guessCategory } from '../classify/heuristic.js';
import { canAdminOrgAuthorPrisma, canManageSkillPrisma, getOrgBySlugPrisma } from '../lib/org-access.js';
import { extractTriggersFromSkillMd, deriveInvocationFacts, TriggersError } from '../skill-frontmatter.js';
import { runPublishEval, EvalError, evalStatusFromMetadataJson } from '../eval-runner.js';
import { bumpAttentionForSkillSubscribersPrisma } from '../lib/attention.js';
import { classifyVersionBumpPrisma } from '../version-label.js';
import { formatVersionLabel } from '../semver-classify.js';
import { isUserSuspendedPrisma, normalizeVersionHash, resolveSkillRefPrisma } from '../lib/ref-resolution.js';
import { buildSkillDetailPrisma } from '../lib/skill-detail-prisma.js';
import { listPublicKitsForSkillPrisma } from '../lib/skill-kits-prisma.js';
import { skillInstallTimeseriesPrisma } from '../lib/skill-install-series.js';
import { resolveReadableVersionPrisma } from '../lib/readable-version-prisma.js';
import { lastCleanHashPrisma } from '../lib/sync-manifest.js';
import { platformAttestationKeyPrisma } from '../lib/platform-signing.js';
import { commitPublishNewVersionPrisma, getSkillForPublishPrisma, persistVersionScanPrisma, skillVersionExistsPrisma, updateSkillVisibilityPrisma } from '../lib/skill-publish.js';
import { computeSkillTokens } from '../lib/skill-tokens.js';
import { authorExistsPrisma } from '../lib/kit-payload.js';
import type { PrismaClient } from '@prisma/client';
import { serveBlockForScanFromInfo, serveBlockForModerationPrisma, serveBlockForScanPrisma } from './serve-guards.js';
import { canReadSkill, canReadSkillPrisma } from '../auth/skill-read-access.js';
export { canReadSkill };
interface PublishBody {
    author: string;
    slug: string;
    /** Bundle wire format (§2.1): path → { enc, data }. */
    files?: BundleFiles;
    /** Canonical content hash of the version the client last saw. */
    base_hash?: string | null;
    /** PROTOCOL §4 author-signing envelope — required for CLI (`publish_auth: signature`). */
    signature?: Signature;
    /** `session` = verified session authorizes (web/desktop); omit signature. */
    publish_auth?: 'session' | 'signature';
    metadata?: Record<string, unknown>;
    /** Skill visibility. Default 'private'; only 'public' makes a skill catalog-visible. */
    visibility?: 'private' | 'public';
    /** Provenance (self-reported by the importer). `source_repo` is the `owner/repo`
     *  the skill was imported from — the key the directory matches on to detect a
     *  canonical mirror; `source_url` is the specific source directory. Display /
     *  linkage only, never a trust input. */
    source_repo?: string;
    source_url?: string;
}
interface ManifestParams {
    author: string;
    slug: string;
}
interface VersionParams {
    author: string;
    slug: string;
    hash: string;
}
interface InstallParams {
    author: string;
    slug: string;
}
/** Normalize a self-reported `owner/repo` provenance string, or null if it isn't
 *  one. Case-preserving; strips a `.git` suffix and any surrounding slashes. This
 *  is the directory's match key, so it must be a clean `owner/repo` — anything
 *  odd (a full URL, extra path segments, junk chars) is dropped to null rather
 *  than stored dirty. */
function sanitizeSourceRepo(raw: unknown): string | null {
    if (typeof raw !== 'string')
        return null;
    const trimmed = raw.trim().replace(/^\/+|\/+$/g, '');
    if (!trimmed || trimmed.length > 200)
        return null;
    const parts = trimmed.split('/');
    if (parts.length !== 2)
        return null;
    const [owner, repoRaw] = parts;
    const repo = repoRaw.replace(/\.git$/i, '');
    if (!/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo))
        return null;
    return `${owner}/${repo}`;
}
/** Normalize a self-reported source URL for display, or null. Only https github.com
 *  URLs are kept — this is provenance shown to a viewer, not fetched, so we don't
 *  need more than "it's a plausible GitHub link, capped in length." */
function sanitizeSourceUrl(raw: unknown): string | null {
    if (typeof raw !== 'string')
        return null;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.length > 400)
        return null;
    try {
        const u = new URL(trimmed);
        if (u.protocol !== 'https:' || u.hostname.toLowerCase() !== 'github.com')
            return null;
        return trimmed;
    }
    catch {
        return null;
    }
}
/**
 * Compute the `scan` field for a manifest/version response. Returns null for
 * clean versions and for versions with no scan row (so the wire payload stays
 * minimal in the default-OK case). `pending` is emitted so subscribers can
 * tell "scan hasn't run yet" from "scan ran clean" — important for the
 * client-side gate (a pending status is not safe to materialize as clean).
 */
/**
 * Cap on the scan-batch member set (KTD6). Sized above the largest realistic
 * kit; an anonymous caller cannot force more than this many DB reads + report
 * builds per request. Requests above the cap are rejected 422.
 */
const MAX_SCAN_BATCH_MEMBERS = 100;
/**
 * Manifest `scan` field derived from an already-read scan row. Lets a caller
 * that also serve-gates on the same row read it once instead of twice.
 */
function scanForManifestFromInfo(info: ScanInfo | null): ScanInfo | null {
    if (!info)
        return null;
    if (info.status === 'clean')
        return null;
    return info;
}
export interface SkillRoutesOptions {
    /**
     * Retained for back-compat with the server opts pass-through. The publish
     * path now scans synchronously at the gate regardless (trust flow), so
     * this flag is a no-op here; the proposal path still honors it.
     */
    scanSync?: boolean;
    /**
     * When set (MySQL cutover / usePrismaAuth), public catalog list reads go
     * through Prisma instead of sqlite.
     */
    prisma?: PrismaDb | PrismaClient;
}
/**
 * Extract the `description` field from a SKILL.md frontmatter block.
 * Handles unquoted, double-quoted, and single-quoted values. Returns null
 * if SKILL.md is absent, has no frontmatter, or has no description key.
 */
function extractDescriptionFromSkillMd(bundle: Map<string, Uint8Array>): string | null {
    const bytes = bundle.get('SKILL.md');
    if (!bytes)
        return null;
    const text = Buffer.from(bytes).toString('utf8');
    const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch)
        return null;
    const yaml = fmMatch[1];
    const descMatch = yaml.match(/^description:\s*(?:"([^"]*)"|'([^']*)'|(.*?))\s*$/m);
    if (!descMatch)
        return null;
    const value = (descMatch[1] ?? descMatch[2] ?? descMatch[3] ?? '').trim();
    return value || null;
}
/** Per-file graded diff between two published versions of a skill. Both sides
 *  read from `skill_version_files` (keyed by the version's content hash); shape
 *  matches the web's `ProposalFileDiff` so the existing diff UI renders it. */
type VersionDiffFile = {
    path: string;
    status: string;
    diff: string | null;
    binary: boolean;
};
type VersionDiffResult = {
    tooLarge: true;
} | {
    tooLarge: false;
    files: VersionDiffFile[];
};
async function computeVersionDiffFromMaps(blobStore: BlobStore, base: Map<string, string>, next: Map<string, string>): Promise<VersionDiffResult> {
    const allPaths = [...new Set([...base.keys(), ...next.keys()])].sort();
    const out: VersionDiffFile[] = [];
    for (const path of allPaths) {
        const baseBlob = base.get(path) ?? null;
        const nextBlob = next.get(path) ?? null;
        if (baseBlob === nextBlob) {
            out.push({ path, status: 'unchanged', diff: null, binary: false });
            continue;
        }
        const status = !baseBlob ? 'added' : !nextBlob ? 'removed' : 'modified';
        const refBytes = (await blobStore.get((nextBlob ?? baseBlob)!)) ?? null;
        if (!refBytes || !isTextFile(path, refBytes)) {
            out.push({ path, status, diff: null, binary: true });
            continue;
        }
        const baseBytes = baseBlob ? ((await blobStore.get(baseBlob)) ?? null) : null;
        const nextBytes = nextBlob ? ((await blobStore.get(nextBlob)) ?? null) : null;
        const result = renderUnifiedDiff(path, baseBlob ?? 'empty', nextBlob ?? 'empty', baseBytes ? decodeText(baseBytes) : '', nextBytes ? decodeText(nextBytes) : '');
        // Over the diff size guard: bail the whole response (the route renders 413)
        // rather than allocate the O(m*n) LCS table for a pathological file.
        if (result.tooLarge)
            return { tooLarge: true };
        out.push({ path, status, diff: result.diff || null, binary: false });
    }
    return { tooLarge: false, files: out };
}
async function computeVersionDiffPrisma(prisma: PrismaDb, blobStore: BlobStore, fromHash: string | null, toHash: string): Promise<VersionDiffResult> {
    const filesFor = async (versionHash: string): Promise<Map<string, string>> => {
        const map = new Map<string, string>();
        const rows = await listVersionFileRowsPrisma(prisma, versionHash);
        for (const r of rows)
            map.set(r.path, r.blob_hash);
        return map;
    };
    const base = fromHash ? await filesFor(fromHash) : new Map<string, string>();
    const next = await filesFor(toHash);
    return computeVersionDiffFromMaps(blobStore, base, next);
}
/** Wire shape for a version with no `skill_version_scans` row yet. */
function pendingScanReportBody() {
    return {
        status: 'pending' as const,
        findings_summary: { total: 0, counts: {}, topConfidence: null, highlights: [] as [
            ] },
        findings: [] as [
        ],
        // No scan row → capabilities were never computed (distinct from
        // computed-and-empty `[]`). Keeps the null-vs-empty wire contract.
        capabilities: null,
        capabilities_analysis: null,
        capabilities_blind_spots: [] as [
        ],
    };
}
/** Max stored length of a single author note (installer-facing, one finding). */
const HARM_NOTE_MAX = 600;
/**
 * Validate + normalize author-supplied per-flag notes. The wire
 * shape is `{ "<category>:<file>:<lineStart>": "<note>" }` — keys identify a
 * specific finding, values explain why the flagged pattern is intentional.
 * Drops non-string / empty / whitespace-only values and caps length. Returns an
 * empty object when there's nothing usable, so callers can skip the write.
 */
function sanitizeHarmNotes(raw: unknown): Record<string, string> {
    if (!raw || typeof raw !== 'object')
        return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value !== 'string')
            continue;
        const note = value.trim();
        if (!note)
            continue;
        out[key] = note.slice(0, HARM_NOTE_MAX);
    }
    return out;
}
function versionCacheHeaders(visibility: string, etag: string, reply: FastifyReply): void {
    reply.header('ETag', etag);
    // Private -> `private, no-store` (not bare `no-cache`, which per RFC 7234
    // still permits a shared cache to STORE the bytes): a shared cache must
    // never retain private bundle bytes. Matches the zip/image routes (#468).
    reply.header('Cache-Control', visibility === 'public' ? 'public, max-age=300' : 'private, no-store');
}
export function registerSkillRoutes(app: FastifyInstance, db: DatabaseSync, blobStore: BlobStore, opts: SkillRoutesOptions = {}): void {
    const prismaOpt = opts.prisma ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined);
    if (!prismaOpt) {
        throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL');
    }
    const prisma = prismaOpt;
    // GET /v1/scanner/cache-stats — content-hash scan cache hit rate.
    // Aggregate counters only (no skill identity, no content), so this is an
    // unauthenticated operational read. `corpus_version` reflects the active
    // detector corpus; hit_rate resets when that is bumped.
    //
    // When Prisma is wired, we read MySQL (`scan_result_cache` /
    // `scan_cache_metrics`); otherwise we fall back to the local sqlite scaffold.
    app.get('/scanner/cache-stats', async () => getScanCacheStatsPrisma(prisma));
    // GET /skills/:author/:slug/diff?from=&to= — per-file "what changed" between two
    // published versions, for the web Updates "what's new" card. `to` is required;
    // `from` defaults to the version published immediately before `to` (null when
    // `to` is the first version → diff against empty). Both are content hashes
    // (= skill_versions.hash). Guarded by canReadSkill: a now-private skill 404s for
    // anyone who can't read it, so neither the range nor the default-from leaks.
    app.get<{
        Params: {
            author: string;
            slug: string;
        };
        Querystring: {
            from?: string;
            to?: string;
        };
    }>('/skills/:author/:slug/diff', async (req, reply) => {
        const { author, slug } = req.params;
        const resolved = await resolveSkillRefPrisma(prisma, author, slug);
        if (!resolved)
            return reply.status(404).send({ error: 'Skill not found' });
        const skillRow = await prisma.skills.findUnique({
            where: { id: resolved.skillId },
            select: { visibility: true },
        });
        if (!skillRow ||
            !(await canReadSkillPrisma(prisma, req.principal, resolved.skillId, skillRow.visibility))) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        if (!req.query.to)
            return reply.status(400).send({ error: 'to is required' });
        const toHash = normalizeVersionHash(req.query.to);
        const toRow = await prisma.skill_versions.findFirst({
            where: {
                skill_id: resolved.skillId,
                OR: [{ hash: toHash }, { hash: `sha256:${toHash}` }],
            },
            select: { hash: true, published_at: true },
        });
        if (!toRow)
            return reply.status(404).send({ error: 'Version not found' });
        let fromHash: string | null = null;
        if (req.query.from) {
            const raw = normalizeVersionHash(req.query.from);
            const fromRow = await prisma.skill_versions.findFirst({
                where: {
                    skill_id: resolved.skillId,
                    OR: [{ hash: raw }, { hash: `sha256:${raw}` }],
                },
                select: { hash: true },
            });
            if (!fromRow)
                return reply.status(404).send({ error: 'Version not found' });
            fromHash = fromRow.hash;
        }
        else {
            const prev = await prisma.skill_versions.findFirst({
                where: {
                    skill_id: resolved.skillId,
                    published_at: { lt: toRow.published_at },
                },
                orderBy: { published_at: 'desc' },
                select: { hash: true },
            });
            fromHash = prev?.hash ?? null;
        }
        const diffResult = await computeVersionDiffPrisma(prisma, blobStore, fromHash, toRow.hash);
        if (diffResult.tooLarge) {
            return reply.status(413).send({
                error: 'diff_too_large',
                message: 'Diff too large to render',
            });
        }
        return reply.send({ from: fromHash, to: toRow.hash, files: diffResult.files });
    });
    // POST /v1/skills — publish a bundle (§2.1) as a content-addressed version.
    //
    // §3 token classes / verified-account gate:
    //   publish uses `requireScope('publish')` (was: requireSession), which:
    //   - rejects kit_key bearers (no publish scope) → 403
    //   - rejects sessions with no IdP-verified email → 403 account_verification_required
    //   - rejects unauth → 401
    // §4 author signing: REQUIRED in v1 — every publish carries an Ed25519
    //                    envelope that MUST verify against the author key
    //                    registered at /api/v1/claim.
    // §7.4 publish-velocity: `requirePublishRateLimit` chains after
    //                    the scope check so it keys on `principal.user_id`.
    //                    429 + Retry-After on exceed. Burst alerts fire from
    //                    `recordPublishAndMaybeAlert` inside the write txn.
    // Path is bare `/skills`; the server mounts this under both /api/v1 and /v1.
    const PUBLISH_BODY_LIMIT_BYTES = 10 * 1024 * 1024;
    app.post<{
        Body: PublishBody;
    }>('/skills', {
        preHandler: [requireScope('publish'), requirePublishRateLimit(db, prisma)],
        bodyLimit: PUBLISH_BODY_LIMIT_BYTES,
    }, async (req, reply) => {
        const { author, slug, files, base_hash, signature, publish_auth: rawPublishAuth, metadata, visibility: rawVisibility, source_repo: rawSourceRepo, source_url: rawSourceUrl, } = req.body ?? {};
        // Provenance is self-reported display/linkage metadata (never a trust input),
        // so validate shape loosely and cap length rather than trusting it wholesale.
        const sourceRepo = sanitizeSourceRepo(rawSourceRepo);
        const sourceUrl = sanitizeSourceUrl(rawSourceUrl);
        const sessionPublish = isSessionPublishAuth(rawPublishAuth);
        const visibility: 'private' | 'public' = rawVisibility === 'public' ? 'public' : 'private';
        if (!author || !slug || !files || typeof files !== 'object') {
            return reply.status(400).send({ error: 'author, slug, and files are required' });
        }
        if (typeof slug !== 'string' || !isValidSkillSlug(slug)) {
            return reply.status(422).send({
                error: 'invalid_slug',
                message: 'Skill slug must be 1-63 lowercase alphanumerics or hyphens, starting with a letter or digit.',
            });
        }
        // A skill slug that collides with a static owner-namespace route segment
        // (kit/followers/following) would publish but be permanently unreachable at
        // /{author}/{slug}. Reject it loudly instead.
        if (isReservedSkillSlug(slug)) {
            return reply.status(400).send({
                error: 'reserved_slug',
                message: `Skill slug '${slug}' is reserved and cannot be used. Choose a different name.`,
            });
        }
        // requireSession guaranteed this branch.
        const principal = req.principal as {
            class: 'session';
            user_id: string;
            handle: string | null;
        };
        // Anti-impersonation: publish as your handle or as an org you administer.
        if (principal.handle == null) {
            return reply.status(403).send({ error: 'handle_not_claimed' });
        }
        if (await isUserSuspendedPrisma(prisma, principal.user_id)) {
            return reply.status(403).send({ error: 'account_suspended' });
        }
        const sessionPrincipal = req.principal as {
            class: 'session';
            user_id: string;
        };
        const personalPublish = principal.handle === author;
        const orgPublish = await canAdminOrgAuthorPrisma(prisma, author, sessionPrincipal.user_id);
        if (!personalPublish && !orgPublish) {
            return reply.status(403).send({
                error: 'author_mismatch',
                message: 'Session must match the publish `author`, or the author must be an org you administer.',
            });
        }
        if (!(await authorExistsPrisma(prisma, author))) {
            return reply.status(404).send({ error: `Author '${author}' not found` });
        }
        // Signature always verifies against the publishing user's registered key.
        const signerHandle = principal.handle;
        const authorRow = await prisma.users.findFirst({
            where: { handle: signerHandle },
            select: { id: true },
        }).then((row) => (row ? { user_id: row.id } : undefined));
        if (!authorRow || authorRow.user_id !== sessionPrincipal.user_id) {
            return reply.status(403).send({
                error: 'author_mismatch',
                message: 'Session is not the owner of the requested author handle. Re-claim or re-authenticate.',
            });
        }
        const publishedBy = signerHandle;
        // Decode + validate the bundle BEFORE looking up the skill. A malformed
        // payload returns 422 from any author, whether or not the skill exists.
        let bundle;
        try {
            bundle = stripSkilletBackupPaths(decodeBundle(files));
            validateBundle(bundle);
        }
        catch (err) {
            if (err instanceof BundleError) {
                return reply.status(422).send({ error: err.code, message: err.message });
            }
            throw err;
        }
        // Extract description from SKILL.md frontmatter so the catalog/detail APIs
        // can surface it without NULL. Done before the write transaction — read-only.
        const bundleDescription = extractDescriptionFromSkillMd(bundle);
        let bundleTriggers: string[] = [];
        try {
            bundleTriggers = extractTriggersFromSkillMd(bundle);
        }
        catch (err) {
            if (err instanceof TriggersError) {
                return reply.status(422).send({ error: err.code, message: err.message });
            }
            throw err;
        }
        let evalStatus: 'passed' | 'failed' | 'none' = 'none';
        try {
            evalStatus = runPublishEval(bundle);
        }
        catch (err) {
            if (err instanceof EvalError) {
                return reply.status(422).send({ error: err.code, message: err.message });
            }
            throw err;
        }
        // Per-flag author notes ride the version metadata. They are
        // installer-facing explanations, so R2: store them ONLY for public skills
        // — a private skill never persists nor serves notes. Strip them off the
        // base metadata spread either way so a private publish can't smuggle them.
        const { harm_notes: rawHarmNotes, ...restMetadata } = metadata ?? {};
        const harmNotes = visibility === 'public' ? sanitizeHarmNotes(rawHarmNotes) : {};
        // Invocation facts (how the skill triggers) — orthogonal to the security
        // scan. Stored as explicit booleans on every publish so the detail API
        // never has to re-parse; legacy versions get them via the one-time backfill.
        const invocation = deriveInvocationFacts(bundle);
        const versionMetadata = {
            ...restMetadata,
            ...(bundleTriggers.length > 0 ? { triggers: bundleTriggers } : {}),
            eval: evalStatus,
            modelInvoked: invocation.modelInvoked,
            hasCommand: invocation.hasCommand,
            ...(sessionPublish ? { publish_auth: PUBLISH_AUTH_SESSION } : {}),
            ...(Object.keys(harmNotes).length > 0 ? { harm_notes: harmNotes } : {}),
        };
        // Synchronous publish-time gate — the trust-flow boundary. Run the full
        // scan over the in-memory bundle BEFORE any DB writes. A high-confidence
        // secret OR a quarantined (confirmed-dangerous) verdict aborts the publish:
        // no skill row, no version row, no blobs land. Applies to public AND
        // private. Flagged/clean fall through; the verdict (cache-warmed here) is
        // persisted after commit. Snippets are never sent on the wire (file:line is
        // enough for the author to locate it; a secret's bytes are the secret).
        // High-confidence secrets are caught by the dedicated synchronous gate
        // (`secretsBlockingScan`) and hard-block here, so they never reach the
        // persisted report. Lower-confidence secret SHAPES do flag (advisory) and
        // are persisted as file:line, but their snippet is stripped before storage
        // (`serializeFindingsForStore`), so the persisted report never mirrors a
        // credential's bytes.
        const secretHit = secretsBlockingScan(bundle);
        if (secretHit) {
            return reply.status(422).send({
                error: 'scan_blocked',
                reason: 'secret' as const,
                status: 'quarantined' as const,
                message: 'Publish blocked: a credential was detected. Remove the secret (use an env var or placeholder) and republish.',
                findings: [
                    {
                        category: secretHit.category,
                        confidence: secretHit.confidence,
                        file: secretHit.file,
                        lineStart: secretHit.lineStart,
                        lineEnd: secretHit.lineEnd,
                        why: secretHit.why,
                    },
                ],
            });
        }
        const verdict = await scanBundleCachedPrisma(prisma, bundle);
        const wireFindings = verdict.findings.map((f) => ({
            category: f.category,
            confidence: f.confidence,
            file: f.file,
            lineStart: f.lineStart,
            lineEnd: f.lineEnd,
            why: f.why,
        }));
        if (verdict.status === 'quarantined') {
            return reply.status(422).send({
                error: 'scan_blocked',
                reason: 'quarantine' as const,
                status: 'quarantined' as const,
                message: 'Publish blocked by our scanner. Fix the flagged patterns and republish.',
                findings: wireFindings,
            });
        }
        const skillId = toSkillId(`${author}/${slug}`);
        const versionHash = canonicalContentHash(bundle);
        const userKeyRow = await prisma.users.findUnique({
            where: { id: authorRow.user_id },
            select: { author_public_key: true, author_key_id: true },
        });
        let verifiedSig: {
            alg: string;
            key_id: string;
            sig: string;
        };
        let primaryKeyId: string | null;
        let delegationJson: string | null;
        // Signature scheme version persisted alongside the envelope (finding #9).
        // Session attestation is NOT a v2 author-key binding, so it is always v1.
        // For the CLI path we read the version off the incoming envelope: a v2
        // envelope binds author_key_id + ref + version + content_hash.
        let sigVersion: number;
        if (sessionPublish) {
            if (signature) {
                return reply.status(422).send({
                    error: 'conflicting_publish_auth',
                    message: 'publish_auth=session must not include a signature envelope. ' +
                        'Omit signature for session publish, or omit publish_auth for CLI signing.',
                });
            }
            const sessionSig = sessionSignatureEnvelope(userKeyRow?.author_key_id ?? null);
            verifiedSig = sessionSig;
            primaryKeyId = userKeyRow?.author_key_id ?? null;
            delegationJson = null;
            sigVersion = 1;
        }
        else {
            // Publish accepts the PRIMARY key or a device delegation with scope
            // `publish` chaining to that primary. Browser author_keys without a cert
            // still fail closed (delegation_not_found).
            if (!signature) {
                return reply.status(422).send({
                    error: 'signature_required',
                    message: 'CLI publish requires an Ed25519 signature envelope, or pass publish_auth: "session" when signed in on web/desktop.',
                });
            }
            if (!authorRow) {
                return reply.status(403).send({ error: 'author_not_claimed' });
            }
            const nextVersion = await nextVersionOrdinalPrisma(prisma, skillId);
            const sigCheck = await resolveAndVerifySignerPrisma(prisma, authorRow.user_id, versionHash, signature, 'publish', { ref: `@${author}/${slug}`, version: nextVersion });
            if ('code' in sigCheck) {
                return reply.status(422).send({ error: sigCheck.code, message: sigCheck.message });
            }
            verifiedSig = signature as Signature;
            primaryKeyId = sigCheck.primary_key_id;
            delegationJson = sigCheck.signed_delegation
                ? JSON.stringify(sigCheck.signed_delegation)
                : null;
            sigVersion = isBundleSignatureV2(signature) ? 2 : 1;
        }
        const existingRaw = await getSkillForPublishPrisma(prisma, skillId);
        const existing = existingRaw ?? null;
        // Quarantine gate: a quarantined skill is frozen — no new versions until an
        // admin clears it, so an author can't republish to escape enforcement.
        if (existing?.moderation_status === 'quarantined') {
            return reply.status(409).send({
                error: 'skill_quarantined',
                message: 'This skill is quarantined by a moderator and cannot accept new versions.',
            });
        }
        // Concurrency guard: if the skill already has a `latest_hash`, the client
        // MUST send the matching `base_hash` to update it. Otherwise we reject as
        // a conflict so two devices can't silently overwrite each other's work.
        if (existing?.latest_hash && base_hash !== existing.latest_hash) {
            return reply.status(409).send({
                error: 'conflict',
                message: 'Local is behind remote. Fetch the latest diff and re-publish.',
                latest_hash: existing.latest_hash,
            });
        }
        // Idempotent: same content already published — return 200 with the existing
        // hash and skip the version write. Still apply visibility so private→public
        // flips work when the bundle bytes are unchanged.
        const alreadyExists = await skillVersionExistsPrisma(prisma, skillId, versionHash);
        if (alreadyExists) {
            if (existing) {
                await updateSkillVisibilityPrisma(prisma, skillId, visibility);
            }
            // Visibility flips (and no-op publishes) still change what public lists show.
            await invalidateCatalogCachesAfterPublish();
            return reply.status(200).send({
                hash: versionHash,
                skill_id: skillId,
                schema_version: ARTIFACT_SCHEMA_VERSION,
                version_url: `/api/v1/skills/${author}/${slug}/versions/${versionHash}`,
                message: 'Version already exists (no-op)',
                already_exists: true,
            });
        }
        // Compute per-file blob hashes once, before the transaction, so SQL inside
        // the txn is straight-line writes.
        const fileBlobs: Array<{
            path: string;
            hash: string;
            bytes: Uint8Array;
        }> = [];
        for (const [path, bytes] of bundle) {
            fileBlobs.push({ path, hash: blobHash(bytes), bytes });
        }
        // Semver bump: classify against the base row the concurrency guard bound
        // to (latest_hash). Only the classification runs here — the numeric label
        // is derived inside the write transaction below, so a concurrent publish
        // can't mint a duplicate. Orthogonal to the signature's integer
        // `nextVersion` binding, which stays untouched.
        const nextSkillMdBytes = bundle.get('SKILL.md');
        const nextSkillMd = nextSkillMdBytes
            ? Buffer.from(nextSkillMdBytes).toString('utf8')
            : null;
        // Context-weight metering (U3): compute AFTER the no-op gate above, so a
        // byte-identical republish returns before compute ever runs. Stored as
        // columns, distinct from metadata_json. token_bundle stays null in v1.
        const skillTokens = computeSkillTokens(nextSkillMd ?? '');
        const bumpKind = await classifyVersionBumpPrisma(prisma, {
            skillId,
            baseHash: existing?.latest_hash ?? null,
            nextFiles: new Map(fileBlobs.map((fb) => [fb.path, fb.hash])),
            nextSkillMd,
            readBlob: (hash) => blobStore.get(hash),
        });
        const orgId = orgPublish
            ?
                ((await getOrgBySlugPrisma(prisma, author))?.id ?? null)
            : null;
        await putFileBlobs(blobStore, fileBlobs);
        const versionLabel = await commitPublishNewVersionPrisma(prisma as PrismaClient, {
            existing: existing as import('../lib/skill-publish.js').PublishSkillRow | null,
            skillId,
            authorId: author,
            slug,
            description: bundleDescription,
            visibility,
            createdByUserId: sessionPrincipal.user_id,
            orgId,
            sourceRepo,
            sourceUrl,
            versionHash,
            signatureAlg: verifiedSig.alg,
            signatureKeyId: verifiedSig.key_id,
            signatureB64: verifiedSig.sig,
            authorKeyId: primaryKeyId,
            sigVersion,
            delegationJson,
            bumpKind,
            metadataJson: JSON.stringify({
                ...versionMetadata,
                ...(orgPublish
                    ? { published_under_org: author, published_by_handle: publishedBy }
                    : {}),
            }),
            publishedBy,
            fileBlobs: fileBlobs.map((fb) => ({ path: fb.path, blobHash: fb.hash })),
            publisherUserId: principal.user_id,
            tokenCount: skillTokens.count,
            tokenAmbient: skillTokens.ambient,
            tokenBundle: null,
            tokenMethod: skillTokens.method,
        });
        const resolved = await resolveScanCachedPrisma(prisma, bundle);
        await persistVersionScanPrisma(prisma, skillId, versionHash, resolved.result.status, resolved.findingsJson, resolved.capabilitiesJson);
        // Prefill a category from the skill's own text — local heuristic, no LLM,
        // so it runs synchronously for PUBLIC and PRIVATE alike (private content
        // never leaves the registry) and covers/sections populate immediately.
        // Only fills when unset, so a user-chosen category is never overwritten on
        // re-publish; it's editable afterward. (Replaced the public-only Haiku
        // classifier — see classify/heuristic.ts.)
        {
            const skillMdBytes = bundle.get('SKILL.md');
            const skillMd = skillMdBytes ? Buffer.from(skillMdBytes).toString('utf8') : '';
            const guessed = guessCategory({ slug, description: bundleDescription, body: skillMd });
            if (guessed) {
                await prisma.skills.updateMany({
                    where: { id: skillId, category: null },
                    data: { category: guessed },
                });
            }
        }
        await bumpAttentionForSkillSubscribersPrisma(prisma, skillId);
        await invalidateCatalogCachesAfterPublish();
        return reply.status(201).send({
            hash: versionHash,
            skill_id: skillId,
            schema_version: ARTIFACT_SCHEMA_VERSION,
            version_label: versionLabel,
            version_url: `/api/v1/skills/${author}/${slug}/versions/${versionHash}`,
            scan: { status: verdict.status, findings: wireFindings },
        });
    });
    // POST /v1/skills/scan — dry-run harm scan. Decodes a bundle and
    // returns the verdict the real publish would produce, WITHOUT writing anything
    // (no skill row, no version row, no scan row). Lets the web publish step show
    // findings and collect per-flag notes before committing. Same auth as publish
    // (`publish` scope). Warms the content-hash cache, so the subsequent real
    // publish of identical content resolves as a cache hit.
    //
    // When Prisma is wired, the content-hash cache is MySQL
    // (`scan_result_cache` / `capability_result_cache`); otherwise we warm the
    // local sqlite scaffold. There is still no skill/version row to persist.
    app.post<{
        Body: {
            files?: unknown;
        };
    }>('/skills/scan', { preHandler: [requireScope('publish')] }, async (req, reply) => {
        const { files } = req.body ?? {};
        if (!files || typeof files !== 'object') {
            return reply.status(400).send({ error: 'files are required' });
        }
        let bundle;
        try {
            bundle = decodeBundle(files as Parameters<typeof decodeBundle>[0]);
            validateBundle(bundle);
        }
        catch (err) {
            if (err instanceof BundleError) {
                return reply.status(422).send({ error: err.code, message: err.message });
            }
            throw err;
        }
        // Unlike the publish gate (which short-circuits on a secret), the dry-run
        // shows the WHOLE picture so the author fixes everything in one pass rather
        // than discovering more issues after each re-check. Run the full corpus AND
        // the dedicated secret detector, then surface the secret as the top blocker.
        const verdict = await scanBundleCachedPrisma(prisma, bundle);
        const findings = verdict.findings.map((f) => ({
            category: f.category,
            confidence: f.confidence,
            file: f.file,
            lineStart: f.lineStart,
            lineEnd: f.lineEnd,
            why: f.why,
            // The author is scanning their own draft, so non-secret findings carry
            // the source peek; a secret's excerpt IS the secret — never serve it.
            ...(f.category !== 'secret' && f.snippet ? { snippet: f.snippet } : {}),
        }));
        const secretHit = secretsBlockingScan(bundle);
        if (secretHit) {
            findings.unshift({
                category: secretHit.category,
                confidence: secretHit.confidence,
                file: secretHit.file,
                lineStart: secretHit.lineStart,
                lineEnd: secretHit.lineEnd,
                why: secretHit.why,
            });
        }
        const status = secretHit || verdict.status === 'quarantined' ? 'quarantined' : verdict.status;
        return reply.send({
            status,
            ...(secretHit ? { reason: 'secret' as const } : {}),
            findings,
        });
    });
    // GET /v1/skills/:author/:slug/manifest — ETag/304 manifest of versions.
    // Private skills return 404 for unauthorized callers (existence-hiding).
    app.get<{
        Params: ManifestParams;
    }>('/skills/:author/:slug/manifest', async (req, reply) => {
        const { author, slug } = req.params;
        const resolved = await resolveSkillRefPrisma(prisma, author, slug);
        if (!resolved) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        const { skillId, author: canonAuthor, slug: canonSlug } = resolved;
        const skill = await prisma.skills.findUnique({
            where: { id: skillId },
            select: {
                id: true,
                latest_hash: true,
                install_count: true,
                visibility: true,
                deprecated_at: true,
                deprecation_message: true,
                org_id: true,
            },
        });
        if (!skill) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        if (!(await canReadSkillPrisma(prisma, req.principal, skillId, skill.visibility))) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        const etag = skill.latest_hash ? `"${skill.latest_hash}"` : '"empty"';
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === etag) {
            return reply.status(304).send();
        }
        const [versions, authorIdentity, orgRow] = await Promise.all([
            prisma.skill_versions.findMany({
                where: { skill_id: skillId },
                orderBy: [{ published_at: 'desc' }, { hash: 'desc' }],
                select: {
                    hash: true,
                    published_at: true,
                    major: true,
                    minor: true,
                    patch: true,
                    signature_alg: true,
                    signature_key_id: true,
                    signature_b64: true,
                    sig_version: true,
                    author_key_id: true,
                    yanked_at: true,
                    metadata_json: true,
                },
            }),
            prisma.users.findFirst({
                where: { handle: canonAuthor },
                select: { author_key_id: true, author_public_key: true },
            }),
            skill.org_id
                ? prisma.organizations.findUnique({
                    where: { id: skill.org_id },
                    select: { slug: true },
                })
                : Promise.resolve(null),
        ]);
        reply.header('ETag', etag);
        // Private manifest -> `private, no-store` so a shared cache never
        // retains it (#468); public stays revalidate-only `no-cache`.
        reply.header('Cache-Control', skill.visibility === 'public' ? 'no-cache' : 'private, no-store');
        const redirectedFrom = resolved.redirected && (author !== canonAuthor || slug !== canonSlug)
            ? `@${author}/${slug}`
            : undefined;
        // Author identity is keyed to the signer of the LATEST version, matching
        // the version route below: a platform-attested latest serves the platform
        // key even when the handle is claimed, because pin recovery
        // (core fetchServedAuthorKey) reads this manifest and must receive the
        // key that actually verifies the served versions. Claim-only handles
        // keep the claimed-user identity; no versions or no signer keeps nulls.
        let servedKeyId = authorIdentity?.author_key_id ?? null;
        let servedPublicKey = authorIdentity?.author_public_key ?? null;
        const latestVersion = skill.latest_hash
            ? versions.find((v) => v.hash === skill.latest_hash)
            : undefined;
        if (latestVersion?.author_key_id) {
            const platformKey = await platformAttestationKeyPrisma(prisma);
            if (latestVersion.author_key_id === platformKey.keyId) {
                servedKeyId = platformKey.keyId;
                servedPublicKey = platformKey.publicKeyB64;
            }
        }
        const versionPayloads = await Promise.all(versions.map(async (v) => {
            const scanInfo = await getScanInfoPrisma(prisma, v.hash);
            const scan = scanForManifestFromInfo(scanInfo);
            const evalStatus = evalStatusFromMetadataJson(v.metadata_json);
            return {
                hash: v.hash,
                published_at: v.published_at,
                version_label: formatVersionLabel(v),
                url: `/api/v1/skills/${canonAuthor}/${canonSlug}/versions/${v.hash}`,
                ...(v.yanked_at ? { yanked: true } : {}),
                signature: wireSignatureFromVersionRow(v),
                ...(scan ? { scan } : {}),
                ...(evalStatus !== 'none' ? { eval: evalStatus } : {}),
            };
        }));
        return reply.status(200).send({
            schema_version: ARTIFACT_SCHEMA_VERSION,
            author: canonAuthor,
            slug: canonSlug,
            skill_id: skillId,
            latest_hash: skill.latest_hash,
            install_count: skill.install_count,
            visibility: skill.visibility,
            author_key_id: servedKeyId,
            author_public_key: servedPublicKey,
            ...(orgRow ? { org_slug: orgRow.slug } : {}),
            ...(skill.deprecated_at
                ? { deprecated: true, deprecation_message: skill.deprecation_message }
                : {}),
            ...(redirectedFrom ? { redirected_from: redirectedFrom } : {}),
            versions: versionPayloads,
        });
    });
    // GET /v1/skills/:author/:slug/versions/:hash — fetch a specific version.
    // Reconstructs the bundle from content-addressed blobs and returns it in
    // wire format (§2.1). Immutable cache for public skills; no-cache for private.
    // Private skills return 404 for unauthorized callers (existence-hiding).
    app.get<{
        Params: VersionParams;
        Querystring: { src?: string; via?: string; runtime?: string };
    }>('/skills/:author/:slug/versions/:hash', async (req, reply) => {
        const { author, slug, hash: hashParam } = req.params;
        const rawHash = normalizeVersionHash(hashParam);
        const version = await prisma.skill_versions.findFirst({
            where: { OR: [{ hash: rawHash }, { hash: `sha256:${rawHash}` }] },
            select: {
                hash: true,
                metadata_json: true,
                published_at: true,
                published_by: true,
                major: true,
                minor: true,
                patch: true,
                signature_alg: true,
                signature_key_id: true,
                signature_b64: true,
                author_key_id: true,
                sig_version: true,
                delegation_json: true,
                skill_id: true,
                yanked_at: true,
                yank_reason: true,
            },
        });
        if (!version) {
            return reply.status(404).send({ error: 'Version not found' });
        }
        const resolved = await resolveSkillRefPrisma(prisma, author, slug);
        if (!resolved || resolved.skillId !== version.skill_id) {
            return reply.status(404).send({ error: 'Version not found' });
        }
        const skillRow = await prisma.skills.findUnique({
            where: { id: version.skill_id },
            select: { visibility: true, author_id: true, slug: true },
        });
        if (!skillRow ||
            !(await canReadSkillPrisma(prisma, req.principal, version.skill_id, skillRow.visibility))) {
            return reply.status(404).send({ error: 'Version not found' });
        }
        if (version.yanked_at) {
            return reply.status(404).send({ error: 'Version not found' });
        }
        const hash = version.hash;
        const modBlock = await serveBlockForModerationPrisma(prisma, version.skill_id);
        if (modBlock) {
            return reply.status(modBlock.status).send(modBlock.body);
        }
        const scanInfo = await getScanInfoPrisma(prisma, hash);
        const scanBlock = serveBlockForScanFromInfo(scanInfo);
        if (scanBlock) {
            // An author can always pull their OWN bundle (this JSON endpoint is
            // what the editor loads to edit) — the scan gate protects downloaders,
            // not the owner. Bypass ONLY a not-yet-run scan (`scan_pending`), never
            // a quarantine (moderation enforcement stays), and only for a principal
            // that can manage the skill. So a scan gap can't lock an author out of
            // their own work.
            const managerUserId = (req.principal as { user_id?: string } | null)?.user_id ?? null;
            const ownerBypass =
                scanBlock.body.error === 'scan_pending' &&
                managerUserId != null &&
                (await canManageSkillPrisma(prisma, version.skill_id, managerUserId));
            if (!ownerBypass) {
                return reply.status(scanBlock.status).send(scanBlock.body);
            }
        }
        const etag = `"${hash}"`;
        // Private version JSON carries the full SKILL.md + file bytes -> `private,
        // no-store` so a shared cache never retains it (#468).
        const cacheControl = skillRow.visibility === 'public' ? 'public, max-age=300' : 'private, no-store';
        if (req.headers['if-none-match'] === etag) {
            reply.header('ETag', etag);
            reply.header('Cache-Control', cacheControl);
            return reply.status(304).send();
        }
        const decoded = await loadBundleForVersionPrisma(prisma, blobStore, hash);
        if (!decoded) {
            return reply.status(500).send({
                error: 'corrupt_storage',
                message: `Version ${hash} failed integrity verification or references missing blobs`,
            });
        }
        const platformKey = await platformAttestationKeyPrisma(prisma);
        const authorPub = version.author_key_id === platformKey.keyId
            ? platformKey.publicKeyB64
            : (await prisma.users.findFirst({
                where: { handle: skillRow.author_id },
                select: { author_public_key: true },
            }))?.author_public_key ?? null;
        const scan = scanForManifestFromInfo(scanInfo);
        reply.header('ETag', etag);
        reply.header('Cache-Control', cacheControl);
        // Summon reach (plan 012 U6): a summon-marked fetch of a PUBLIC skill
        // bumps the aggregate counter. Fire-and-forget — never awaited into the
        // response, never throws, no PII. A plain (unmarked) fetch counts nothing,
        // so installs/sync/web-views are unaffected.
        if (req.query.src === 'summon' && skillRow.visibility === 'public') {
            void emitSummonEvent({
                prisma,
                skillId: version.skill_id,
                viaHandle: typeof req.query.via === 'string' ? req.query.via : '',
                // `req.principal` is already resolved: registerAuthDecorator mounts a
                // global preHandler that attaches it for any valid token and lets each
                // route decide. Public reads ignore it, so reading it here introduces
                // no new auth path and cannot reject a request that works today.
                authed: isAccountBound(req.principal ?? null),
            }).catch(() => {});
        }
        return reply.status(200).send({
            schema_version: ARTIFACT_SCHEMA_VERSION,
            hash,
            skill_id: version.skill_id,
            author: skillRow.author_id,
            slug: skillRow.slug,
            files: encodeBundle(decoded),
            content_hash: hash,
            signature: wireSignatureFromVersionRow(version),
            author_key_id: version.author_key_id,
            author_public_key: authorPub,
            delegation: version.delegation_json
                ? (JSON.parse(version.delegation_json) as unknown)
                : null,
            metadata: JSON.parse(version.metadata_json) as unknown,
            published_at: version.published_at,
            published_by: version.published_by,
            version_label: formatVersionLabel(version),
            ...(version.yanked_at ? { yanked: true, yank_reason: version.yank_reason } : {}),
            ...(scan ? { scan } : {}),
        });
    });
    // GET /v1/skills/:author/:slug/versions/:hash/files — file index (metadata only).
    // Cheap listing for web SSR: paths + sizes without loading blob bodies.
    app.get<{
        Params: VersionParams;
    }>('/skills/:author/:slug/versions/:hash/files', async (req, reply) => {
        const { author, slug, hash: hashParam } = req.params;
        const resolved = await resolveReadableVersionPrisma(prisma, req.principal, author, slug, hashParam);
        if (!resolved.ok) {
            return reply.status(resolved.status).send(resolved.body ?? { error: 'Version not found' });
        }
        const etag = `"${resolved.hash}-files"`;
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === etag) {
            versionCacheHeaders(resolved.visibility, etag, reply);
            return reply.status(304).send();
        }
        const rows = (await listVersionFileRowsPrisma(prisma, resolved.hash)).filter((row) => !isSkilletBackupPath(row.path));
        const files = rows.map((row) => fileMetaFromPathAndSize(row.path, row.size));
        versionCacheHeaders(resolved.visibility, etag, reply);
        return reply.status(200).send({
            schema_version: ARTIFACT_SCHEMA_VERSION,
            hash: resolved.hash,
            author: resolved.canonAuthor,
            slug: resolved.canonSlug,
            files,
        });
    });
    // GET /v1/skills/:author/:slug/versions/:hash/file?path= — one decoded file.
    app.get<{
        Params: VersionParams;
        Querystring: {
            path?: string;
        };
    }>('/skills/:author/:slug/versions/:hash/file', async (req, reply) => {
        const { author, slug, hash: hashParam } = req.params;
        const rawPath = req.query.path ?? '';
        const filePath = normalizeBundleFilePath(rawPath);
        if (!filePath) {
            return reply.status(400).send({ error: 'invalid_path' });
        }
        if (isSkilletBackupPath(filePath)) {
            return reply.status(404).send({ error: 'File not found' });
        }
        const resolved = await resolveReadableVersionPrisma(prisma, req.principal, author, slug, hashParam);
        if (!resolved.ok) {
            return reply.status(resolved.status).send(resolved.body ?? { error: 'Version not found' });
        }
        const loaded = await loadFileForVersionPrisma(prisma, blobStore, resolved.hash, filePath, resolved.skillId);
        if (!loaded) {
            return reply.status(404).send({ error: 'File not found' });
        }
        const meta = fileMetaFromBytes(loaded.path, loaded.bytes);
        const etag = `"${resolved.hash}:${filePath}"`;
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === etag) {
            versionCacheHeaders(resolved.visibility, etag, reply);
            return reply.status(304).send();
        }
        versionCacheHeaders(resolved.visibility, etag, reply);
        return reply.status(200).send({
            schema_version: ARTIFACT_SCHEMA_VERSION,
            hash: resolved.hash,
            author: resolved.canonAuthor,
            slug: resolved.canonSlug,
            ...meta,
        });
    });
    // GET /v1/skills/:author/:slug/versions/:hash/files/* — raw bytes of ONE
    // bundle file, straight from the blob store (never the whole-bundle zip:
    // one manifest row lookup + one blob get; per-blob hash verification is the
    // integrity guarantee). The path shape is generic on purpose — a future
    // per-file text lazy-load extends this route — but today the extension
    // allowlist restricts it to inline raster images. Gate order mirrors the
    // version route above; a non-image or absent path 404s identically to a
    // version the caller can't read (existence-hiding).
    app.get<{
        Params: VersionParams & {
            '*': string;
        };
    }>('/skills/:author/:slug/versions/:hash/files/*', async (req, reply) => {
        const { author, slug, hash: hashParam } = req.params;
        const rawHash = normalizeVersionHash(hashParam);
        const notFound = { error: 'File not found' };
        const version = await prisma.skill_versions.findFirst({
            where: { OR: [{ hash: rawHash }, { hash: `sha256:${rawHash}` }] },
            select: { hash: true, skill_id: true, yanked_at: true },
        });
        if (!version)
            return reply.status(404).send(notFound);
        const resolved = await resolveSkillRefPrisma(prisma, author, slug);
        if (!resolved || resolved.skillId !== version.skill_id) {
            return reply.status(404).send(notFound);
        }
        const skillRow = await prisma.skills.findUnique({
            where: { id: version.skill_id },
            select: { visibility: true },
        });
        if (!skillRow ||
            !(await canReadSkillPrisma(prisma, req.principal, version.skill_id, skillRow.visibility))) {
            return reply.status(404).send(notFound);
        }
        if (version.yanked_at)
            return reply.status(404).send(notFound);
        const modBlock = await serveBlockForModerationPrisma(prisma, version.skill_id);
        if (modBlock)
            return reply.status(modBlock.status).send(modBlock.body);
        const scanBlock = await serveBlockForScanPrisma(prisma, version.hash);
        if (scanBlock)
            return reply.status(scanBlock.status).send(scanBlock.body);
        const filePath = req.params['*'] ?? '';
        if (bundlePathError(filePath) || isSkilletBackupPath(filePath)) {
            return reply.status(404).send(notFound);
        }
        const ext = inlineImageExtension(filePath);
        if (!ext)
            return reply.status(404).send(notFound);
        const fileRow = await prisma.skill_version_files.findFirst({
            where: {
                skill_id: version.skill_id,
                version_hash: version.hash,
                path: filePath,
            },
            select: { blob_hash: true, blobs: { select: { size: true } } },
        });
        if (!fileRow)
            return reply.status(404).send(notFound);
        if (fileRow.blobs.size > MAX_INLINE_IMAGE_BYTES) {
            return reply.status(413).send({
                error: 'file_too_large',
                message: `File exceeds the ${MAX_INLINE_IMAGE_BYTES}-byte inline image limit`,
            });
        }
        const etag = `"${version.hash}:file:${fileRow.blob_hash}"`;
        const cacheControl = skillRow.visibility === 'public' ? 'public, max-age=300' : 'no-store';
        if (req.headers['if-none-match'] === etag) {
            reply.header('ETag', etag);
            reply.header('Cache-Control', cacheControl);
            return reply.status(304).send();
        }
        let bytes: Uint8Array | null;
        try {
            bytes = await blobStore.get(fileRow.blob_hash);
        }
        catch {
            bytes = null;
        }
        if (!bytes) {
            return reply.status(500).send({
                error: 'corrupt_storage',
                message: `File in version ${version.hash} failed integrity verification or is missing`,
            });
        }
        reply.header('Content-Type', INLINE_IMAGE_CONTENT_TYPES[ext]);
        reply.header('ETag', etag);
        reply.header('Cache-Control', cacheControl);
        return reply.status(200).send(Buffer.from(bytes));
    });
    // Serve a resolved version as a `.zip` bundle for upload-only surfaces
    // (ChatGPT Skills, Claude Projects, manual installs). Callers MUST gate on
    // canReadSkill before invoking this.
    //
    // Caching (visibility is revocable, so never `immutable`):
    //   - private  -> `no-store` (a zip download is stricter than the version
    //     endpoint's `no-cache`; a shared cache never retains the bytes).
    //   - public + immutable URL (versioned `/versions/:hash/download`)
    //     -> `public, max-age=300`, content-addressed and safe to cache.
    //   - public + MUTABLE URL (latest `/download`, target = `latest_hash`)
    //     -> `public, no-cache`: must revalidate via the ETag, or a CDN would
    //     serve the prior version's bytes for up to the TTL after a publish, yank,
    //     or retroactive quarantine. Mirrors the mutable manifest endpoint.
    const serveBundleZip = async (reply: FastifyReply, hash: string, visibility: string, slug: string, mutableUrl: boolean, skillId: string) => {
        // Slug regex is [a-z0-9-]; re-sanitized as defense-in-depth, then used both
        // as the download filename and as the in-zip folder so the archive unpacks to
        // `<slug>/SKILL.md` — a skill is a folder, and a loose SKILL.md would clobber
        // the next one on a manual install.
        const safeSlug = slug.replace(/[^a-z0-9-]/g, '') || 'skill';
        // Skill-level admin quarantine blocks every version's bytes.
        const modBlock = await serveBlockForModerationPrisma(prisma, skillId);
        if (modBlock) {
            return reply.status(modBlock.status).send(modBlock.body);
        }
        // Never serve bytes of a quarantined version (mirrors the version endpoint).
        const scanBlock = await serveBlockForScanPrisma(prisma, hash);
        if (scanBlock) {
            return reply.status(scanBlock.status).send(scanBlock.body);
        }
        // Reconstruction (blob reads + integrity verify) and packing both run on
        // untrusted-at-rest bytes. A null result is corrupt storage; a throw from
        // either a transient blob-store error or the packer (path re-validation /
        // missing SKILL.md) is treated the same way rather than as an unguarded 500
        // that could echo internal detail.
        let zip: Uint8Array;
        try {
            const decoded = await loadBundleForVersionPrisma(prisma, blobStore, hash);
            if (!decoded) {
                return reply.status(500).send({
                    error: 'corrupt_storage',
                    message: `Version ${hash} failed integrity verification or references missing blobs`,
                });
            }
            zip = bundleToZip(decoded, { prefix: safeSlug });
        }
        catch {
            return reply.status(500).send({
                error: 'corrupt_storage',
                message: `Version ${hash} could not be packaged for download`,
            });
        }
        const cacheControl = visibility !== 'public' ? 'no-store' : mutableUrl ? 'public, no-cache' : 'public, max-age=300';
        reply.header('Content-Type', 'application/zip');
        reply.header('Content-Disposition', `attachment; filename="${safeSlug}.zip"`);
        reply.header('ETag', `"${hash}:zip"`);
        reply.header('Cache-Control', cacheControl);
        return reply.status(200).send(Buffer.from(zip));
    };
    // GET /v1/skills/:author/:slug/versions/:hash/download — a specific version as
    // a `.zip`. Same auth + visibility gate as the version endpoint;
    // private skills 404 for unauthorized callers.
    app.get<{
        Params: VersionParams;
    }>('/skills/:author/:slug/versions/:hash/download', async (req, reply) => {
        const { author, slug, hash: hashParam } = req.params;
        const rawHash = normalizeVersionHash(hashParam);
        const version = await prisma.skill_versions.findFirst({
            where: { OR: [{ hash: rawHash }, { hash: `sha256:${rawHash}` }] },
            select: { hash: true, skill_id: true, yanked_at: true },
        });
        if (!version) {
            return reply.status(404).send({ error: 'Version not found' });
        }
        const resolved = await resolveSkillRefPrisma(prisma, author, slug);
        if (!resolved || resolved.skillId !== version.skill_id) {
            return reply.status(404).send({ error: 'Version not found' });
        }
        const skillRow = await prisma.skills.findUnique({
            where: { id: version.skill_id },
            select: { visibility: true, slug: true },
        });
        if (!skillRow ||
            !(await canReadSkillPrisma(prisma, req.principal, version.skill_id, skillRow.visibility))) {
            return reply.status(404).send({ error: 'Version not found' });
        }
        if (version.yanked_at) {
            return reply.status(404).send({ error: 'Version not found' });
        }
        return serveBundleZip(reply, version.hash, skillRow.visibility, skillRow.slug, false, version.skill_id);
    });
    // GET /v1/skills/:author/:slug/download — the current (latest) version as a
    // `.zip`, so the web can link by author/slug without knowing the hash. Same
    // visibility gate; private skills 404 for unauthorized callers.
    app.get<{
        Params: {
            author: string;
            slug: string;
        };
    }>('/skills/:author/:slug/download', async (req, reply) => {
        const { author, slug } = req.params;
        const resolved = await resolveSkillRefPrisma(prisma, author, slug);
        if (!resolved) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        const skillRow = await prisma.skills.findUnique({
            where: { id: resolved.skillId },
            select: { visibility: true, slug: true, latest_hash: true },
        });
        if (!skillRow ||
            !(await canReadSkillPrisma(prisma, req.principal, resolved.skillId, skillRow.visibility))) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        if (!skillRow.latest_hash) {
            return reply.status(404).send({ error: 'Skill has no published version' });
        }
        return serveBundleZip(reply, skillRow.latest_hash, skillRow.visibility, skillRow.slug, true, resolved.skillId);
    });
    // GET /v1/skills/:author/:slug/versions/:hash/scan — public scan report
    // for one version. Backs the skill page's expandable "security tab":
    // status badge + per-finding category / confidence / file / line range / why.
    //
    // Snippets are intentionally NOT served here (see PublicFinding) — excerpts of
    // flagged source must not be re-published to anonymous callers. Visibility is
    // gated exactly like the version endpoint: private skills 404 for unauthorized
    // callers (existence-hiding), so the scan report never leaks the existence of
    // a private skill.
    app.get<{
        Params: VersionParams;
    }>('/skills/:author/:slug/versions/:hash/scan', async (req, reply) => {
        const { author, slug, hash } = req.params;
        const skillId = tryToSkillId(`${author}/${slug}`);
        if (!skillId) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        const skillRow = await prisma.skills.findUnique({
            where: { id: skillId },
            select: { visibility: true },
        });
        if (!skillRow ||
            !(await canReadSkillPrisma(prisma, req.principal, skillId, skillRow.visibility))) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        // Confirm the version belongs to this skill before reporting its scan —
        // a scan row keyed by a hash from a different skill must not be readable
        // through this skill's (possibly public) path.
        const rawHash = normalizeVersionHash(hash);
        const version = await prisma.skill_versions.findFirst({
            where: {
                skill_id: skillId,
                OR: [{ hash }, { hash: rawHash }, { hash: `sha256:${rawHash}` }],
            },
            select: { hash: true },
        });
        if (!version) {
            return reply.status(404).send({ error: 'Version not found' });
        }
        const report = await getScanReportPrisma(prisma, version.hash, { snippets: true });
        if (!report) {
            return reply.status(200).send(pendingScanReportBody());
        }
        const allowSnippets = req.principal != null || report.status !== 'quarantined';
        if (!allowSnippets) {
            report.findings = report.findings.map(({ snippet: _omit, ...f }) => f);
        }
        reply.header('ETag', `"${hash}:scan:cv${CAPABILITY_VERSION}:dv${DETECTOR_CORPUS_VERSION}"`);
        reply.header('Cache-Control', skillRow.visibility === 'public' ? 'public, max-age=300' : 'private, no-store');
        return reply.status(200).send(report);
    });
    // GET /v1/skills/scan/batch?members=author/slug/hash,author/slug/hash,… —
    // per-member scan reports for a member set in ONE cacheable request (KTD4/U6).
    // Backs the kit trust-panel roll-up, replacing its N per-member `/scan` GETs.
    //
    // Each member is independently ACL-gated exactly like the single `/scan` route
    // (canReadSkill + version-belongs), so an unreadable private member is OMITTED
    // (existence-hiding), never 404-ing the whole batch. The endpoint is
    // unauthenticated (mirrors the single route), so it is length-capped and
    // dedup'd (KTD6) to prevent an anonymous amplification DoS. The response stays
    // cacheable: its ETag folds the READABLE member set + both detector versions,
    // and Cache-Control is `public, max-age` only when every included member is
    // public (else `no-cache`, since a private member makes it principal-specific).
    app.get<{
        Querystring: {
            members?: string;
        };
    }>('/skills/scan/batch', async (req, reply) => {
        const raw = typeof req.query.members === 'string' ? req.query.members.trim() : '';
        if (!raw) {
            return reply.status(200).send({ reports: [] });
        }
        // Parse `author/slug/hash` tuples; the hash may itself contain no `/`
        // (`sha256:hex`), so split into at most three parts.
        const parsed: Array<{
            author: string;
            slug: string;
            hash: string;
            key: string;
        }> = [];
        const seen = new Set<string>();
        for (const token of raw.split(',')) {
            const t = token.trim();
            if (!t)
                continue;
            const slash1 = t.indexOf('/');
            const slash2 = slash1 < 0 ? -1 : t.indexOf('/', slash1 + 1);
            if (slash1 < 0 || slash2 < 0) {
                return reply.status(422).send({ error: 'bad_member', message: `Malformed member tuple: ${t}` });
            }
            const author = t.slice(0, slash1);
            const slug = t.slice(slash1 + 1, slash2);
            const hash = t.slice(slash2 + 1);
            if (!author || !slug || !hash) {
                return reply.status(422).send({ error: 'bad_member', message: `Malformed member tuple: ${t}` });
            }
            const key = `${author}/${slug}/${hash}`;
            if (seen.has(key))
                continue; // dedupe before report-building (KTD6)
            seen.add(key);
            parsed.push({ author, slug, hash, key });
        }
        // Length cap AFTER dedupe so a caller can't force N DB reads + report builds.
        if (parsed.length > MAX_SCAN_BATCH_MEMBERS) {
            return reply.status(422).send({
                error: 'too_many_members',
                message: `A scan batch may contain at most ${MAX_SCAN_BATCH_MEMBERS} members.`,
            });
        }
        interface BatchEntry {
            author: string;
            slug: string;
            hash: string;
            report: unknown;
            isPublic: boolean;
        }
        const included: BatchEntry[] = [];
        for (const m of parsed) {
            // A ref that can't canonicalize can't name a real skill — omit it
            // (existence-hiding), the same as a missing/unreadable entry below.
            let skillId: SkillId;
            try {
                skillId = toSkillId(`${m.author}/${m.slug}`);
            }
            catch {
                continue;
            }
            if (prisma) {
                const skillRow = await prisma.skills.findUnique({
                    where: { id: skillId },
                    select: { visibility: true },
                });
                if (!skillRow ||
                    !(await canReadSkillPrisma(prisma, req.principal, skillId, skillRow.visibility))) {
                    continue;
                }
                const rawHash = normalizeVersionHash(m.hash);
                const belongs = await prisma.skill_versions.findFirst({
                    where: {
                        skill_id: skillId,
                        OR: [{ hash: m.hash }, { hash: rawHash }, { hash: `sha256:${rawHash}` }],
                    },
                    select: { hash: true },
                });
                if (!belongs)
                    continue;
                const report = await getScanReportPrisma(prisma, belongs.hash, { snippets: true });
                if (!report) {
                    included.push({
                        author: m.author,
                        slug: m.slug,
                        hash: m.hash,
                        isPublic: skillRow.visibility === 'public',
                        report: pendingScanReportBody(),
                    });
                    continue;
                }
                const allowSnippets = req.principal != null || report.status !== 'quarantined';
                if (!allowSnippets) {
                    report.findings = report.findings.map(({ snippet: _omit, ...f }) => f);
                }
                included.push({
                    author: m.author,
                    slug: m.slug,
                    hash: m.hash,
                    isPublic: skillRow.visibility === 'public',
                    report,
                });
                continue;
            }
            // Sqlite dual-path removed in U5; MySQL is required for scan batch.
            continue;
        }
        // ETag folds the READABLE member set (not just the requested one), so a member
        // dropping out of the readable set changes the tag and prevents a stale 304.
        const memberFold = createHash('sha256')
            .update(included.map((e) => `${e.author}/${e.slug}/${e.hash}`).join(','))
            .digest('hex')
            .slice(0, 32);
        const etag = `"scanbatch:cv${CAPABILITY_VERSION}:dv${DETECTOR_CORPUS_VERSION}:${memberFold}"`;
        // Any private member makes the response principal-specific → not shared-cacheable.
        // Private -> `private, no-store` (carries finding snippets = private
        // content excerpts); a shared cache must never retain it (#468).
        const allPublic = included.every((e) => e.isPublic);
        reply.header('ETag', etag);
        reply.header('Cache-Control', allPublic ? 'public, max-age=300' : 'private, no-store');
        const ifNoneMatch = req.headers['if-none-match'];
        if (ifNoneMatch && ifNoneMatch === etag) {
            return reply.status(304).send();
        }
        return reply.status(200).send({
            reports: included.map((e) => ({
                author: e.author,
                slug: e.slug,
                hash: e.hash,
                report: e.report,
            })),
        });
    });
    // POST /v1/skills/:author/:slug/install — increment install count.
    // Gate on canReadSkill so private skills return 404 to anonymous callers.
    // Without this, anonymous gets 200 for private-and-exists vs 404 for not-found —
    // a definitive existence oracle that defeats the 404-hiding the rest of this PR
    // establishes, and allows arbitrary install_count inflation on private skills.
    app.post<{
        Params: InstallParams;
    }>('/skills/:author/:slug/install', async (req, reply) => {
        const { author, slug } = req.params;
        const skillId = tryToSkillId(`${author}/${slug}`);
        if (!skillId) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        const skill = await prisma.skills.findUnique({
            where: { id: skillId },
            select: { visibility: true },
        });
        if (!skill ||
            !(await canReadSkillPrisma(prisma, req.principal, skillId, skill.visibility))) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        const { recorded } = await recordSkillInstallPrisma(prisma, skillId, req.principal, req.ip);
        const { followed } = recorded
            ? await autoFollowAuthorOnInstallPrisma(prisma as PrismaClient, req.principal, author)
            : { followed: false };
        return reply.status(200).send({ ok: true, recorded, followed });
    });
    // GET /v1/skills/:author/:slug/installs/timeseries — OWNER-SCOPED install curve,
    // bucketed by hour or day over a window. Powers "did the tweet/vouch drive
    // installs?" — a self-attributing spike proof read off the deduped, timestamped
    // skill_installers rows (NOT referral/shared-link attribution). Gated to the
    // skill's owner via canManageSkill; there is deliberately no public fine-grained
    // per-skill install curve (stats.ts stays the only public surface, and it is
    // month-granularity + catalog-wide, so it can't isolate one skill's spike).
    app.get<{
        Params: InstallParams;
        Querystring: {
            bucket?: string;
            from?: string;
            to?: string;
        };
    }>('/skills/:author/:slug/installs/timeseries', { preHandler: requireScope('publish') }, async (req, reply) => {
        const { author, slug } = req.params;
        const principal = req.principal as {
            class: 'session';
            user_id: string;
        };
        const parseUnix = (v: string | undefined, fallback: number): number => {
            if (v === undefined)
                return fallback;
            const n = Number(v);
            return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
        };
        const bucket = req.query.bucket === 'hour' ? 'hour' : 'day';
        const now = Math.floor(Date.now() / 1000);
        const DEFAULT_WINDOW_S = 30 * 24 * 60 * 60; // 30 days
        const to = parseUnix(req.query.to, now);
        const from = parseUnix(req.query.from, to - DEFAULT_WINDOW_S);
        if (from >= to) {
            return reply.status(400).send({ error: 'invalid_window' });
        }
        const resolved = await resolveSkillRefPrisma(prisma, author, slug);
        if (!resolved)
            return reply.status(404).send({ error: 'skill_not_found' });
        if (!(await canManageSkillPrisma(prisma, resolved.skillId, principal.user_id))) {
            return reply.status(403).send({ error: 'not_authorized' });
        }
        const series = await skillInstallTimeseriesPrisma(prisma, resolved.skillId, {
            bucket,
            from,
            to,
        });
        return reply.status(200).send({
            skill_id: resolved.skillId,
            bucket,
            from,
            to,
            series,
        });
    });
    // PATCH /v1/skills/:author/:slug/category — set (or clear) a skill's category.
    // Owner-only, lightweight (no republish): the category is user-facing metadata,
    // editable independent of the bundle. Body: { category: <key> | null }. Powers
    // the category picker on the edit page and future bulk category edits. A null
    // clears it; an unknown key is rejected so a bad value can't land in the column.
    app.patch<{
        Params: InstallParams;
        Body: { category?: string | null };
    }>('/skills/:author/:slug/category', { preHandler: requireScope('publish') }, async (req, reply) => {
        const { author, slug } = req.params;
        const principal = req.principal as { class: 'session'; user_id: string };
        const raw = req.body?.category;
        if (raw !== null && raw !== undefined && !isCategoryKey(raw)) {
            return reply.status(400).send({ error: 'invalid_category' });
        }
        const category = raw == null ? null : raw;
        const resolved = await resolveSkillRefPrisma(prisma, author, slug);
        if (!resolved)
            return reply.status(404).send({ error: 'skill_not_found' });
        if (!(await canManageSkillPrisma(prisma, resolved.skillId, principal.user_id))) {
            return reply.status(403).send({ error: 'not_authorized' });
        }
        await prisma.skills.update({
            where: { id: resolved.skillId },
            data: { category },
        });
        await invalidateCatalogCachesAfterPublish();
        return reply.status(200).send({ skill_id: resolved.skillId, category });
    });
    // GET /v1/skills/:author/:slug/kits — public kits that contain this skill.
    // Anyone can see which public kits curate a skill; private kits never appear.
    // 404s for a skill the caller can't read, matching the rest of this surface.
    app.get<{
        Params: InstallParams;
    }>('/skills/:author/:slug/kits', async (req, reply) => {
        const { author, slug } = req.params;
        const skillId = tryToSkillId(`${author}/${slug}`);
        if (!skillId) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        const skill = await prisma.skills.findUnique({
            where: { id: skillId },
            select: { visibility: true },
        });
        if (!skill ||
            !(await canReadSkillPrisma(prisma, req.principal, skillId, skill.visibility))) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        const kits = await listPublicKitsForSkillPrisma(prisma, skillId);
        return reply.send({ kits });
    });
    // GET /v1/skills — public catalog list for the web directory.
    // Only skills with visibility='public' appear in the anonymous catalog.
    // Published skills only (latest_hash NOT NULL), most-installed first.
    // Paginated; optional `q` does a case-insensitive slug/description match.
    app.get<{
        Querystring: {
            limit?: string;
            offset?: string;
            q?: string;
            category?: string;
            sort?: string;
        };
    }>('/skills', async (req, reply) => {
        const limit = clampInt(req.query.limit, 50, 1, 100);
        const offset = clampInt(req.query.offset, 0, 0, MAX_PAGE_OFFSET);
        const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
        // One known key, or a comma-separated list (a section landing). Unknown
        // values are dropped, so a bad key never widens the query.
        const categories = parseCategoryFilter(req.query.category);
        const sort: CatalogSkillSort | undefined = req.query.sort === 'new' || req.query.sort === 'alpha' ? req.query.sort : undefined;
        const memoKey = catalogListMemoKey('skills', {
            limit,
            offset,
            q: q || undefined,
            category: categories?.slice().sort().join(',') || undefined,
            sort,
        });
        const body = await catalogListMemo.getOrLoad(memoKey, async () => {
            const [total, rows] = await Promise.all([
                countPublicCatalogSkillsPrisma(prisma, { q: q || undefined, categories }),
                listPublicCatalogSkillSummariesPrisma(prisma, {
                    limit,
                    offset,
                    q: q || undefined,
                    categories,
                    sort,
                }),
            ]);
            const usedByBySkill = await catalogUsedByFacesPrisma(prisma, rows.map((r) => r.skill_id));
            return {
                skills: rows.map((r) => {
                    const faces = (usedByBySkill.get(r.skill_id) ?? []).filter((f) => f.handle !== r.author_id);
                    return {
                        ...toSkillSummary(r),
                        used_by: faces.slice(0, 3),
                        used_by_count: faces.length,
                    };
                }),
                total,
                limit,
                offset,
            };
        });
        setPublicCatalogListCacheHeaders(reply);
        return reply.status(200).send(body);
    });
    // GET /v1/skills/:author/:slug — public skill detail for the web page.
    // Summary + author display fields + the registered author key
    // so the page can TOFU-verify without a second round-trip to the manifest.
    // Private skills return 404 for unauthorized callers (existence-hiding).
    app.get<{
        Params: ManifestParams;
    }>('/skills/:author/:slug', async (req, reply) => {
        const { author, slug } = req.params;
        const resolved = await resolveSkillRefPrisma(prisma, author, slug);
        if (!resolved) {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        const result = await buildSkillDetailPrisma(prisma, {
            skillId: resolved.skillId,
            canonAuthor: resolved.author,
            canonSlug: resolved.slug,
            principal: req.principal,
        });
        if (result.kind === 'not_found') {
            return reply.status(404).send({ error: 'Skill not found' });
        }
        if (result.kind === 'deprecated') {
            return reply.status(410).send(result.body);
        }
        return reply.status(200).send(result.body);
    });
    interface DeprecateBody {
        message?: string;
    }
    interface YankBody {
        reason?: string;
    }
    // Reset latest_hash to the newest INSTALLABLE version — non-yanked AND not
    // quarantined. Used after a yank and after a retroactive quarantine, so the
    // installable pointer never lands on a dangerous version.
    async function rebalanceLatestHashPrisma(skillId: string): Promise<void> {
        const clean = await lastCleanHashPrisma(prisma, skillId);
        await prisma.skills.update({
            where: { id: skillId },
            data: { latest_hash: clean },
        });
    }
    // POST /skills/:author/:slug/versions/:hash/yank — hide version from new installs.
    app.post<{
        Params: VersionParams;
        Body: YankBody;
    }>('/skills/:author/:slug/versions/:hash/yank', { preHandler: requireScope('publish') }, async (req, reply) => {
        const { author, slug, hash: hashParam } = req.params;
        const principal = req.principal as {
            class: 'session';
            user_id: string;
        };
        const rawHash = normalizeVersionHash(hashParam);
        const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : null;
        const resolved = await resolveSkillRefPrisma(prisma, author, slug);
        if (!resolved)
            return reply.status(404).send({ error: 'skill_not_found' });
        if (!(await canManageSkillPrisma(prisma, resolved.skillId, principal.user_id))) {
            return reply.status(403).send({ error: 'not_authorized' });
        }
        const version = await prisma.skill_versions.findFirst({
            where: {
                skill_id: resolved.skillId,
                OR: [{ hash: rawHash }, { hash: `sha256:${rawHash}` }],
            },
            select: { hash: true },
        });
        if (!version)
            return reply.status(404).send({ error: 'version_not_found' });
        const now = Math.floor(Date.now() / 1000);
        await prisma.skill_versions.update({
            where: {
                skill_id_hash: { skill_id: resolved.skillId, hash: version.hash },
            },
            data: { yanked_at: now, yank_reason: reason },
        });
        const skill = await prisma.skills.findUnique({
            where: { id: resolved.skillId },
            select: { latest_hash: true },
        });
        const storedLatest = skill?.latest_hash ?? null;
        if (storedLatest === version.hash ||
            storedLatest === rawHash ||
            storedLatest === `sha256:${rawHash}`) {
            await rebalanceLatestHashPrisma(resolved.skillId);
        }
        return reply.status(200).send({
            skill_id: resolved.skillId,
            hash: version.hash,
            yanked: true,
        });
    });
    app.post<{
        Params: VersionParams;
    }>('/skills/:author/:slug/versions/:hash/unyank', { preHandler: requireScope('publish') }, async (req, reply) => {
        const { author, slug, hash: hashParam } = req.params;
        const principal = req.principal as {
            class: 'session';
            user_id: string;
        };
        const rawHash = normalizeVersionHash(hashParam);
        const resolved = await resolveSkillRefPrisma(prisma, author, slug);
        if (!resolved)
            return reply.status(404).send({ error: 'skill_not_found' });
        if (!(await canManageSkillPrisma(prisma, resolved.skillId, principal.user_id))) {
            return reply.status(403).send({ error: 'not_authorized' });
        }
        const version = await prisma.skill_versions.findFirst({
            where: {
                skill_id: resolved.skillId,
                OR: [{ hash: rawHash }, { hash: `sha256:${rawHash}` }],
            },
            select: { hash: true },
        });
        if (!version)
            return reply.status(404).send({ error: 'version_not_found' });
        await prisma.skill_versions.update({
            where: {
                skill_id_hash: { skill_id: resolved.skillId, hash: version.hash },
            },
            data: { yanked_at: null, yank_reason: null },
        });
        await rebalanceLatestHashPrisma(resolved.skillId);
        return reply.status(200).send({
            skill_id: resolved.skillId,
            hash: version.hash,
            yanked: false,
        });
    });
    // PATCH /skills/:author/:slug/versions/:hash/notes — save per-flag author
    // notes after publish without a republish. Notes are installer-
    // facing, so they're stored ONLY for public skills (R2); a PATCH against a
    // private skill is rejected. Replaces the version's harm_notes wholesale (the
    // editor sends the full set), merged into the existing metadata_json.
    app.patch<{
        Params: VersionParams;
        Body: {
            harm_notes?: unknown;
        };
    }>('/skills/:author/:slug/versions/:hash/notes', { preHandler: requireScope('publish') }, async (req, reply) => {
        const { author, slug, hash: hashParam } = req.params;
        const principal = req.principal as {
            class: 'session';
            user_id: string;
        };
        const rawHash = normalizeVersionHash(hashParam);
        const notes = sanitizeHarmNotes(req.body?.harm_notes);
        const resolved = await resolveSkillRefPrisma(prisma, author, slug);
        if (!resolved)
            return reply.status(404).send({ error: 'skill_not_found' });
        if (!(await canManageSkillPrisma(prisma, resolved.skillId, principal.user_id))) {
            return reply.status(403).send({ error: 'not_authorized' });
        }
        const skill = await prisma.skills.findUnique({
            where: { id: resolved.skillId },
            select: { visibility: true },
        });
        if (!skill)
            return reply.status(404).send({ error: 'skill_not_found' });
        if (skill.visibility !== 'public') {
            return reply.status(409).send({
                error: 'notes_private_skill',
                message: 'Notes are installer-facing and only apply to public skills.',
            });
        }
        const version = await prisma.skill_versions.findFirst({
            where: {
                skill_id: resolved.skillId,
                OR: [{ hash: rawHash }, { hash: `sha256:${rawHash}` }],
            },
            select: { hash: true, metadata_json: true },
        });
        if (!version)
            return reply.status(404).send({ error: 'version_not_found' });
        let meta: Record<string, unknown> = {};
        try {
            meta = JSON.parse(version.metadata_json) as Record<string, unknown>;
        }
        catch {
        }
        if (Object.keys(notes).length > 0) {
            meta.harm_notes = notes;
        }
        else {
            delete meta.harm_notes;
        }
        await prisma.skill_versions.update({
            where: {
                skill_id_hash: { skill_id: resolved.skillId, hash: version.hash },
            },
            data: { metadata_json: JSON.stringify(meta) },
        });
        return reply.status(200).send({ hash: version.hash, harm_notes: notes });
    });
    // POST /skills/:author/:slug/deprecate — soft sunset.
    app.post<{
        Params: ManifestParams;
        Body: DeprecateBody;
    }>('/skills/:author/:slug/deprecate', { preHandler: requireScope('publish') }, async (req, reply) => {
        const { author, slug } = req.params;
        const skillId = tryToSkillId(`${author}/${slug}`);
        if (!skillId)
            return reply.status(404).send({ error: 'skill_not_found' });
        const principal = req.principal as {
            class: 'session';
            user_id: string;
        };
        const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 500) : null;
        const skill = await prisma.skills.findUnique({
            where: { id: skillId },
            select: { id: true },
        });
        if (!skill)
            return reply.status(404).send({ error: 'skill_not_found' });
        if (!(await canManageSkillPrisma(prisma, skillId, principal.user_id))) {
            return reply.status(403).send({ error: 'not_authorized' });
        }
        await prisma.skills.update({
            where: { id: skillId },
            data: {
                deprecated_at: Math.floor(Date.now() / 1000),
                deprecation_message: message,
            },
        });
        return reply.status(200).send({ skill_id: skillId, deprecated: true });
    });
    app.post<{
        Params: ManifestParams;
    }>('/skills/:author/:slug/undeprecate', { preHandler: requireScope('publish') }, async (req, reply) => {
        const { author, slug } = req.params;
        const skillId = tryToSkillId(`${author}/${slug}`);
        if (!skillId)
            return reply.status(404).send({ error: 'skill_not_found' });
        const principal = req.principal as {
            class: 'session';
            user_id: string;
        };
        const skill = await prisma.skills.findUnique({
            where: { id: skillId },
            select: { id: true },
        });
        if (!skill)
            return reply.status(404).send({ error: 'skill_not_found' });
        if (!(await canManageSkillPrisma(prisma, skillId, principal.user_id))) {
            return reply.status(403).send({ error: 'not_authorized' });
        }
        await prisma.skills.update({
            where: { id: skillId },
            data: { deprecated_at: null, deprecation_message: null },
        });
        return reply.status(200).send({ skill_id: skillId, deprecated: false });
    });
    // POST /skills/:author/:slug/visibility — flip public/private. Visibility is
    // registry metadata, not part of the signed bundle, so this is a plain
    // ownership-checked mutation: no signature or republish required.
    app.post<{
        Params: ManifestParams;
        Body: {
            visibility?: string;
        };
    }>('/skills/:author/:slug/visibility', { preHandler: requireScope('publish') }, async (req, reply) => {
        const { author, slug } = req.params;
        const skillId = tryToSkillId(`${author}/${slug}`);
        if (!skillId)
            return reply.status(404).send({ error: 'skill_not_found' });
        const principal = req.principal as {
            class: 'session';
            user_id: string;
        };
        const visibility = req.body?.visibility;
        if (visibility !== 'public' && visibility !== 'private') {
            return reply.status(400).send({ error: "visibility must be 'public' or 'private'" });
        }
        const skill = await prisma.skills.findUnique({
            where: { id: skillId },
            select: { id: true },
        });
        if (!skill)
            return reply.status(404).send({ error: 'skill_not_found' });
        if (!(await canManageSkillPrisma(prisma, skillId, principal.user_id))) {
            return reply.status(403).send({ error: 'not_authorized' });
        }
        await updateSkillVisibilityPrisma(prisma, skillId, visibility);
        return reply.status(200).send({ skill_id: skillId, visibility });
    });
}
/** Parse a querystring int, falling back to `def`, clamped to [min, max]. */
function clampInt(raw: string | undefined, def: number, min: number, max: number): number {
    if (raw === undefined)
        return def;
    const n = Number.parseInt(raw, 10);
    if (Number.isNaN(n))
        return def;
    return Math.min(Math.max(n, min), max);
}
