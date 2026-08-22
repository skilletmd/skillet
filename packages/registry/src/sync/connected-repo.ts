// Re-publishing a user's CONNECTED repo (self-serve "connect your GitHub repo"),
// shared by the manual refresh route and the nightly job.
//
// It lives here rather than inside routes/connected-repos.ts because a connected
// repo used to sync only when a human poked it: once at connect time, and again
// whenever they hit refresh. Nothing scheduled touched it, while the skill page
// told every visitor the source "Syncs daily". Adding a nightly pass meant a
// second copy of the publish rules, and a second copy is how the two drift —
// most dangerously on `publish_as`, where the rule is a permission check.
import type { PrismaClient } from '@prisma/client';
import { syncRepoSkillsPrisma, type SyncResult } from './sync-repo.js';
import { decryptToken } from './repo-auth.js';
import { canAdminOrgAuthorPrisma } from '../lib/org-access.js';
import type { BlobStore } from '../blob-store/types.js';

/** A connected_repos row, narrowed to what publishing needs. */
export interface ConnectedRepoRow {
    id: string;
    user_id: string;
    owner: string;
    repo: string;
    token_enc: string | null;
    selected_dirs: string | null;
    as_kit: number;
    publish_as: string | null;
}

export type ConnectedSyncOutcome =
    | { ok: true; result: SyncResult }
    /** No stored token: the user must reconnect before we can read the repo. */
    | { ok: false; reason: 'no_token' }
    /** The owner has no handle to publish under. */
    | { ok: false; reason: 'no_handle' }
    /**
     * The row publishes under a team the owning user no longer administers.
     * Re-checked on EVERY sync, not just at connect time — otherwise losing team
     * access would leave a background job still publishing in the team's name.
     */
    | { ok: false; reason: 'publish_as_forbidden' };

function parseSelectedDirs(raw: string | null): string[] | undefined {
    if (!raw) return undefined;
    try {
        const v: unknown = JSON.parse(raw);
        return Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length > 0
            ? (v as string[])
            : undefined;
    }
    catch {
        return undefined;
    }
}

/**
 * Publish one connected repo and stamp the row. Returns a typed refusal rather
 * than throwing for the three expected "not right now" cases, so the route can
 * map them to status codes and the nightly can count them.
 */
export async function syncConnectedRepoPrisma(
    prisma: PrismaClient,
    row: ConnectedRepoRow,
    opts: { blobStore: BlobStore },
): Promise<ConnectedSyncOutcome> {
    if (!row.token_enc) return { ok: false, reason: 'no_token' };

    const user = await prisma.users.findUnique({
        where: { id: row.user_id },
        select: { handle: true },
    });
    const handle = user?.handle ?? null;
    if (!handle) return { ok: false, reason: 'no_handle' };

    const authorHandle = row.publish_as ?? handle;
    if (row.publish_as && row.publish_as !== handle) {
        const allowed = await canAdminOrgAuthorPrisma(prisma, row.publish_as, row.user_id);
        if (!allowed) return { ok: false, reason: 'publish_as_forbidden' };
    }

    const selectedDirs = parseSelectedDirs(row.selected_dirs);
    const result = await syncRepoSkillsPrisma(prisma, row.owner, row.repo, {
        authorHandle,
        repoFull: `${row.owner}/${row.repo}`,
        license: null,
        token: decryptToken(row.token_enc),
        blobStore: opts.blobStore,
        bundle: row.as_kit !== 0,
        ...(selectedDirs ? { selectedDirs } : {}),
    });

    await prisma.connected_repos.update({
        where: { id: row.id },
        data: { last_synced_sha: result.sha, last_synced_at: Math.floor(Date.now() / 1000) },
    });
    return { ok: true, result };
}

export interface ConnectedSyncSummary {
    synced: number;
    failed: number;
    skipped: number;
    /** Per-repo outcomes, for the nightly's JSON summary line. */
    repos: Array<{ repo: string; status: string }>;
}

/**
 * Nightly pass: re-publish every ACTIVE connected repo. Fail-soft per repo — one
 * user's revoked token must not stop everyone else's source from staying current.
 */
export async function syncAllConnectedReposPrisma(
    prisma: PrismaClient,
    opts: { blobStore: BlobStore },
): Promise<ConnectedSyncSummary> {
    const rows = await prisma.connected_repos.findMany({
        where: { status: 'active' },
        select: {
            id: true, user_id: true, owner: true, repo: true,
            token_enc: true, selected_dirs: true, as_kit: true, publish_as: true,
        },
        orderBy: { created_at: 'asc' },
    });
    const summary: ConnectedSyncSummary = { synced: 0, failed: 0, skipped: 0, repos: [] };
    for (const row of rows) {
        const label = `${row.owner}/${row.repo}`;
        try {
            const out = await syncConnectedRepoPrisma(prisma, row, opts);
            if (out.ok) {
                summary.synced++;
                summary.repos.push({ repo: label, status: 'synced' });
            }
            else {
                summary.skipped++;
                summary.repos.push({ repo: label, status: out.reason });
                console.warn(`  ~ skipped ${label}: ${out.reason}`);
            }
        }
        catch (err) {
            summary.failed++;
            summary.repos.push({ repo: label, status: 'failed' });
            console.warn(`  ! failed ${label}: ${(err as Error).message}`);
        }
    }
    return summary;
}
