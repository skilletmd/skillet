// Self-serve "connect your GitHub repo" (docs/plans/connect-your-repo.md).
//
//   POST   /api/v1/github/repos             connect a repo + first sync
//   GET    /api/v1/github/repos             list the caller's connected repos
//   POST   /api/v1/github/repos/:id/refresh re-sync now
//   DELETE /api/v1/github/repos/:id         disconnect (and remove its skills)
//
// The read-only GitHub OAuth token rides in the connect body, so — like
// /auth/link — these routes require BOTH a user session AND the trusted BFF's
// internal secret (the token is a credential; a raw session replay must not be
// able to inject one).
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { DatabaseSync } from '../db/sqlite-handle.js';
import type { PrismaClient } from '@prisma/client';
import { requireSession } from '../auth/middleware.js';
import { verifyWebInternalSignature } from '../auth/web-internal-sig.js';
import { newId } from '../db/index.js';
import type { PrismaDb } from '../db/prisma-client.js';
import { encryptToken, decryptToken, verifyRepoOwnership, listOwnedRepos, getGithubUser, } from '../sync/repo-auth.js';
import { getUserGithubTokenPrisma, storeUserGithubTokenPrisma, userHasGithubTokenPrisma, } from '../sync/github-token.js';
import { canAdminOrgAuthorPrisma } from '../lib/org-access.js';
import { syncRepoSkillsPrisma, type SyncResult } from '../sync/sync-repo.js';
import type { BlobStore } from '../blob-store/types.js';
// SECURITY: the read-only GitHub OAuth token rides in the connect body, so POST
// /api/v1/github/repos requires BOTH a user session AND proof the request came
// from the trusted web BFF. The BFF proves itself by HMAC-signing the request
// (see ../auth/web-internal-sig.ts) rather than presenting a raw shared secret —
// holding the secret alone no longer suffices. This route MUST NEVER be
// internet-routable: the browser BFF proxy strips the x-skillet-web-* signing
// headers, so a browser can never originate a valid signature.
/** Upper bound on the per-request `dirs` selection (resource-exhaustion guard). */
const MAX_SELECTED_DIRS = 100;
function bffAuthorized(req: FastifyRequest, devAuth: boolean): boolean {
    return verifyWebInternalSignature({
        method: req.method,
        url: req.url,
        body: req.body ?? {},
        headers: req.headers,
        devAuth,
    });
}
const REPO_PART = /^[A-Za-z0-9._-]+$/;
interface ConnectBody {
    owner?: string;
    repo?: string;
    token?: string;
    license?: string;
    /** Skill dirs to sync (subset). Omit to sync all skills in the repo. */
    dirs?: string[];
    /** Name for the linked kit (>1 skill). Defaults to the humanized repo name. */
    kitName?: string;
    /** Bundle >1 skill into a kit (default true); false publishes them loose. */
    bundle?: boolean;
    /** Publish under a team the caller admins instead of their own handle. */
    publishAs?: string;
}
interface RepoRow {
    id: string;
    owner: string;
    repo: string;
    default_branch: string | null;
    token_enc: string | null;
    last_synced_sha: string | null;
    last_synced_at: number | null;
    status: string;
    created_at: number;
    selected_dirs: string | null;
    as_kit: number;
    publish_as: string | null;
}
function publicRepo(r: RepoRow): object {
    return {
        id: r.id,
        owner: r.owner,
        repo: r.repo,
        full: `${r.owner}/${r.repo}`,
        url: `https://github.com/${r.owner}/${r.repo}`,
        default_branch: r.default_branch,
        last_synced_at: r.last_synced_at,
        status: r.status,
        created_at: r.created_at,
    };
}
/** Live skills mirrored from this repo (slug + description + category). */
async function repoSkillsPrisma(prisma: PrismaDb, authorHandle: string, full: string): Promise<Array<{
    slug: string;
    description: string | null;
    category: string | null;
}>> {
    const mirrors = await prisma.skill_mirrors.findMany({
        where: { source_repo: full },
        select: { skill_id: true },
    });
    if (mirrors.length === 0)
        return [];
    return prisma.skills.findMany({
        where: {
            author_id: authorHandle,
            id: { in: mirrors.map((m) => m.skill_id) },
        },
        orderBy: { slug: 'asc' },
        select: { slug: true, description: true, category: true },
    });
}
/** Linked kit a >1-skill repo publishes into (null for a single loose skill). */
async function repoKitPrisma(prisma: PrismaDb, authorHandle: string, full: string): Promise<{
    id: string;
    name: string;
    slug: string | null;
} | null> {
    const kit = await prisma.kits.findFirst({
        where: { owner_id: authorHandle, source_repo: full, source_type: 'linked' },
        select: { id: true, name: true, slug: true },
    });
    return kit ? { id: kit.id, name: kit.name, slug: kit.slug } : null;
}
// The stored selection of synced dirs — a JSON string array, or null when the
// whole repo syncs. Tolerates a malformed value by treating it as "sync all".
function parseSelectedDirs(raw: string | null): string[] | null {
    if (!raw)
        return null;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed))
            return parsed.filter((d): d is string => typeof d === 'string');
    }
    catch {
    }
    return null;
}
/** publicRepo plus synced skills and linked kit for the settings list. */
async function enrichedRepoPrisma(prisma: PrismaDb, authorHandle: string, r: RepoRow): Promise<object> {
    const full = `${r.owner}/${r.repo}`;
    const skills = await repoSkillsPrisma(prisma, authorHandle, full);
    return {
        ...publicRepo(r),
        author: authorHandle,
        selected_dirs: parseSelectedDirs(r.selected_dirs),
        skill_count: skills.length,
        skills,
        kit: await repoKitPrisma(prisma, authorHandle, full),
    };
}
function toRepoRow(r: {
    id: string;
    owner: string;
    repo: string;
    default_branch: string | null;
    token_enc: string | null;
    last_synced_sha: string | null;
    last_synced_at: number | null;
    status: string;
    created_at: number;
    selected_dirs: string | null;
    as_kit: number;
    publish_as: string | null;
}): RepoRow {
    return {
        id: r.id,
        owner: r.owner,
        repo: r.repo,
        default_branch: r.default_branch,
        token_enc: r.token_enc,
        last_synced_sha: r.last_synced_sha,
        last_synced_at: r.last_synced_at,
        status: r.status,
        created_at: r.created_at,
        selected_dirs: r.selected_dirs,
        as_kit: r.as_kit,
        publish_as: r.publish_as,
    };
}

function requirePrisma(prisma: PrismaClient | undefined): PrismaClient {
  if (!prisma) {
    throw new Error('sqlite registry store removed; use Prisma / DATABASE_URL')
  }
  return prisma
}

export function registerConnectedRepoRoutes(app: FastifyInstance, db: DatabaseSync, opts: {
    devAuth?: boolean;
    prisma?: PrismaClient;
    blobStore?: BlobStore;
} = {}): void {
    // Fail closed: with no signing secret configured the BFF gate opens ONLY under
    // the explicit dev-auth gate (in-memory DB / SKILLET_ENABLE_DEV_AUTH=1), never
    // on NODE_ENV alone — unified with web-routes.ts via verifyWebInternalSignature.
    const devAuth = opts.devAuth === true;
    const prisma = requirePrisma(
      opts.prisma ?? (app.skilletPrismaAuth && app.skilletPrisma ? app.skilletPrisma : undefined),
    );
    const blobStore = opts.blobStore;
    if (!blobStore) {
      throw new Error('registerConnectedRepoRoutes requires opts.blobStore');
    }
    // Connect a repo the caller owns, and sync its skills under their handle.
    app.post<{
        Body: ConnectBody;
    }>('/api/v1/github/repos', { preHandler: requireSession }, async (req, reply) => {
        if (req.principal?.class !== 'session') {
            return reply.code(403).send({ error: 'wrong_token_class' });
        }
        const handle = req.principal.handle;
        if (!handle) {
            return reply
                .code(409)
                .send({ error: 'handle_required', message: 'Claim a handle before connecting a repo.' });
        }
        if (!bffAuthorized(req, devAuth)) {
            return reply.code(401).send({ error: 'web_internal_auth_required' });
        }
        // Publish under a team you administer, or yourself. Verify admin rights
        // before trusting publishAs — this is the gate for team publishing.
        const publishAs = req.body?.publishAs?.trim();
        if (publishAs && publishAs !== handle) {
            const allowed = await canAdminOrgAuthorPrisma(prisma, publishAs, req.principal.user_id);
            if (!allowed) {
                return reply.code(403).send({
                    error: 'publish_as_forbidden',
                    message: 'Publish under your handle or a team you administer.',
                });
            }
        }
        const authorHandle = publishAs && publishAs !== handle ? publishAs : handle;
        const owner = req.body?.owner?.trim();
        const repo = req.body?.repo?.trim();
        if (!owner || !repo || !REPO_PART.test(owner) || !REPO_PART.test(repo)) {
            return reply.code(400).send({ error: 'invalid_repo' });
        }
        // Fail fast on an oversized `dirs` selection — before any GitHub work — so a
        // caller can't force unbounded sync.
        if (Array.isArray(req.body?.dirs) && req.body!.dirs.length > MAX_SELECTED_DIRS) {
            return reply.code(400).send({ error: 'too_many_dirs', max: MAX_SELECTED_DIRS });
        }
        // Resolve the GitHub token: an explicit body token (the one-time minimal
        // grant) takes precedence, else the user's stored read-only token (captured
        // at GitHub sign-in or a prior connect). A body token is also persisted so
        // the next "Add a repo" needs no re-grant — one connection for everyone.
        const bodyToken = req.body?.token?.trim();
        if (bodyToken) {
            await storeUserGithubTokenPrisma(prisma, req.principal.user_id, bodyToken);
        }
        const token = bodyToken
            ? bodyToken
            :
                await getUserGithubTokenPrisma(prisma, req.principal.user_id);
        if (!token) {
            return reply.code(400).send({
                error: 'github_not_connected',
                message: 'Connect GitHub first, then add a repo.',
            });
        }
        let ownership;
        try {
            ownership = await verifyRepoOwnership(owner, repo, token);
        }
        catch (err) {
            // Explicit send — the global error handler won't intercept it, so scrub
            // the upstream error text by hand. The detail goes to the log, not the
            // wire; the request id lets a report correlate to the server-side log.
            req.log.error({ err, reqId: req.id }, 'github ownership check failed');
            return reply
                .code(502)
                .send({ error: 'github_unreachable', message: 'Could not reach GitHub. Try again.', request_id: req.id });
        }
        if (!ownership.ownsRepo) {
            // 404 (private/inaccessible to a read-only token) and pull-only both land
            // here. We read public repos only, so the fix is never "grant more scope"
            // — it's "pick a public repo you own."
            return reply.code(403).send({
                error: 'not_repo_owner',
                message: 'Connect a public repo you own. Private repos and repos you only have read access to can’t be synced.',
            });
        }
        const dirs = Array.isArray(req.body?.dirs) ? req.body!.dirs.filter((d) => typeof d === 'string') : null;
        const selectedDirsJson = dirs ? JSON.stringify(dirs) : null;
        // Default to bundling (a multi-skill repo is a kit); the wizard sends
        // bundle:false to publish loose. Persisted so re-sync respects the choice.
        const asKit = req.body?.bundle === false ? 0 : 1;
        // Store the team handle (null = personal) so a later refresh re-syncs under
        // the same owner instead of the refreshing user.
        const publishAsStored = authorHandle !== handle ? authorHandle : null;
        const id = newId();
        const tokenEnc = encryptToken(token);
        await prisma.connected_repos.upsert({
            where: {
                user_id_owner_repo: {
                    user_id: req.principal.user_id,
                    owner,
                    repo,
                },
            },
            create: {
                id,
                user_id: req.principal.user_id,
                owner,
                repo,
                default_branch: ownership.defaultBranch,
                token_enc: tokenEnc,
                selected_dirs: selectedDirsJson,
                as_kit: asKit,
                publish_as: publishAsStored,
                status: 'active',
                created_at: Math.floor(Date.now() / 1000),
            },
            update: {
                default_branch: ownership.defaultBranch,
                token_enc: tokenEnc,
                selected_dirs: selectedDirsJson,
                as_kit: asKit,
                publish_as: publishAsStored,
                status: 'active',
            },
        });
        let result: SyncResult;
        try {
            const syncOpts = {
                authorHandle,
                repoFull: `${owner}/${repo}`,
                license: req.body?.license ?? null,
                token,
                blobStore,
                bundle: asKit !== 0,
                ...(dirs ? { selectedDirs: dirs } : {}),
                ...(req.body?.kitName ? { kitName: req.body.kitName } : {}),
            };
            result =
                await syncRepoSkillsPrisma(prisma, owner, repo, syncOpts);
        }
        catch (err) {
            // Explicit send — scrub the upstream/sync error text (it can carry repo
            // paths, tokens in URLs, or library internals). Full detail to the log.
            req.log.error({ err, reqId: req.id }, 'repo sync failed');
            return reply
                .code(502)
                .send({ error: 'sync_failed', message: 'Repo sync failed. Try again.', request_id: req.id });
        }
        // Nothing to sync = don't keep a pointless connection. Roll it back and tell
        // the user the repo has no skills (no SKILL.md found / none could be synced).
        if (result.skills.length === 0) {
            await prisma.connected_repos.deleteMany({
                where: { user_id: req.principal.user_id, owner, repo },
            });
            return reply.code(422).send({
                error: 'no_skills',
                message: `No SKILL.md skills found in ${owner}/${repo}. Nothing to sync.`,
            });
        }
        const syncedAt = Math.floor(Date.now() / 1000);
        await prisma.connected_repos.updateMany({
            where: { user_id: req.principal.user_id, owner, repo },
            data: { last_synced_sha: result.sha, last_synced_at: syncedAt },
        });
        const row = await prisma.connected_repos.findFirst({
            where: { user_id: req.principal.user_id, owner, repo },
        });
        if (!row)
            return reply.code(500).send({ error: 'connected_repo_missing' });
        return reply.code(201).send({ repo: publicRepo(toRepoRow(row)), sync: result });
    });
    // List the caller's connected repos.
    app.get('/api/v1/github/repos', { preHandler: requireSession }, async (req, reply) => {
        if (req.principal?.class !== 'session') {
            return reply.code(403).send({ error: 'wrong_token_class' });
        }
        const handle = req.principal.handle ?? '';
        const rows = await prisma.connected_repos.findMany({
            where: { user_id: req.principal.user_id },
            orderBy: { created_at: 'desc' },
        });
        return reply.send({
            repos: await Promise.all(rows.map((r) => enrichedRepoPrisma(prisma, r.publish_as ?? handle, toRepoRow(r)))),
        });
    });
    // The caller's owned public repos for the connect picker, listed with their
    // STORED read-only GitHub token — which never leaves the registry. `connected`
    // is the single "do we hold a usable GitHub token" signal the settings UI uses.
    // Read-only listing, but still BFF-gated (it reveals the user's repo names).
    app.get('/api/v1/github/owned-repos', { preHandler: requireSession }, async (req, reply) => {
        if (req.principal?.class !== 'session') {
            return reply.code(403).send({ error: 'wrong_token_class' });
        }
        if (!bffAuthorized(req, devAuth)) {
            return reply.code(401).send({ error: 'web_internal_auth_required' });
        }
        const token = await getUserGithubTokenPrisma(prisma, req.principal.user_id);
        if (!token)
            return reply.send({ connected: false, repos: [], user: null });
        // The repos to add + the authed GitHub identity (login + real display name),
        // so the connection card shows the actual GitHub name, not a Skillet alias.
        const [repos, user] = await Promise.all([listOwnedRepos(token), getGithubUser(token)]);
        return reply.send({ connected: true, repos, user });
    });
    // Persist the read-only token from the one-time minimal-scope connect, so a
    // non-GitHub-sign-in user becomes "connected" like everyone else (no per-add
    // re-grant). BFF-signed: the token is a credential a raw session must not inject.
    app.post<{
        Body: {
            token?: string;
        };
    }>('/api/v1/github/connect-token', { preHandler: requireSession }, async (req, reply) => {
        if (req.principal?.class !== 'session') {
            return reply.code(403).send({ error: 'wrong_token_class' });
        }
        if (!bffAuthorized(req, devAuth)) {
            return reply.code(401).send({ error: 'web_internal_auth_required' });
        }
        const token = req.body?.token?.trim();
        if (!token)
            return reply.code(400).send({ error: 'token_required' });
        await storeUserGithubTokenPrisma(prisma, req.principal.user_id, token);
        return reply.send({
            ok: true,
            github_token_present: await userHasGithubTokenPrisma(prisma, req.principal.user_id),
        });
    });
    // Re-sync a connected repo now (manual refresh) using its stored token.
    app.post<{
        Params: {
            id: string;
        };
    }>('/api/v1/github/repos/:id/refresh', { preHandler: requireSession }, async (req, reply) => {
        if (req.principal?.class !== 'session') {
            return reply.code(403).send({ error: 'wrong_token_class' });
        }
        const handle = req.principal.handle;
        if (!handle)
            return reply.code(409).send({ error: 'handle_required' });
        const row = await prisma.connected_repos
            .findFirst({
            where: { id: req.params.id, user_id: req.principal.user_id },
        })
            .then((r) => (r ? toRepoRow(r) : null));
        if (!row)
            return reply.code(404).send({ error: 'not_found' });
        if (!row.token_enc)
            return reply.code(409).send({ error: 'no_token' });
        // Re-publish under the stored owner (a team, or the user). Re-verify team
        // admin so a user who lost access can't keep syncing under the team.
        const authorHandle = row.publish_as ?? handle;
        if (row.publish_as && row.publish_as !== handle) {
            const allowed = await canAdminOrgAuthorPrisma(prisma, row.publish_as, req.principal.user_id);
            if (!allowed) {
                return reply.code(403).send({
                    error: 'publish_as_forbidden',
                    message: 'You no longer have publish access to that team.',
                });
            }
        }
        const selectedDirs = parseSelectedDirs(row.selected_dirs) ?? undefined;
        let result: SyncResult;
        try {
            const syncOpts = {
                authorHandle,
                repoFull: `${row.owner}/${row.repo}`,
                license: null as string | null,
                token: decryptToken(row.token_enc),
                blobStore,
                bundle: row.as_kit !== 0,
                ...(selectedDirs ? { selectedDirs } : {}),
            };
            result =
                await syncRepoSkillsPrisma(prisma, row.owner, row.repo, syncOpts);
        }
        catch (err) {
            // Explicit send — scrub the upstream/sync error text (it can carry repo
            // paths, tokens in URLs, or library internals). Full detail to the log.
            req.log.error({ err, reqId: req.id }, 'repo sync failed');
            return reply
                .code(502)
                .send({ error: 'sync_failed', message: 'Repo sync failed. Try again.', request_id: req.id });
        }
        await prisma.connected_repos.update({
            where: { id: row.id },
            data: {
                last_synced_sha: result.sha,
                last_synced_at: Math.floor(Date.now() / 1000),
            },
        });
        return reply.send({ sync: result });
    });
    // Disconnect = STOP syncing, keep what's published. The synced skills and their
    // kit stay (frozen at the last sync); only the live link is removed. Re-connect
    // to resume. (Deliberately not destructive — disconnecting GitHub shouldn't
    // unpublish a kit you've shared.)
    app.delete<{
        Params: {
            id: string;
        };
    }>('/api/v1/github/repos/:id', { preHandler: requireSession }, async (req, reply) => {
        if (req.principal?.class !== 'session') {
            return reply.code(403).send({ error: 'wrong_token_class' });
        }
        const deleted = await prisma.connected_repos.deleteMany({
            where: { id: req.params.id, user_id: req.principal.user_id },
        });
        if (deleted.count === 0)
            return reply.code(404).send({ error: 'not_found' });
        return reply.send({ ok: true, stopped: true });
    });
}
