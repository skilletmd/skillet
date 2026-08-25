// Nightly mirror ops — the loop that keeps the mirrored library current and
// the review queue fed. Three phases, each independently idempotent:
//
//   1. Re-sync every mirror-sources.json seed (content-hash no-ops when
//      upstream is unchanged; tombstones vanished skills; holds on scan block).
//   2. Re-sync every LIVE queue-approved mirror not covered by the seed file.
//      The work list comes from mirror_review_queue (status 'live'), NOT from
//      skill_mirrors: approve marks a row live even when its initial sync
//      failed, and deriving work from skill_mirrors would leave such a mirror
//      empty forever ("skills backfill on next sync" is this code path).
//   3. Discovery: topic sweeps + import provenance, denylisted and
//      quality-gated, PROPOSING into mirror_review_queue. Publishing still
//      requires a human admin approval.
//
// Concurrency: one run at a time, enforced by a MySQL advisory lock taken on a
// DEDICATED single-connection client (advisory locks are session-scoped; on
// the pooled client the lock would ride an arbitrary connection and could be
// dropped mid-run by pool recycling). The in-flight unique index on
// mirror_review_queue backstops discovery double-enqueue at the DB level.
//
// A core-API rate limit aborts remaining sync sources AND skips discovery
// (candidate screening burns the same core quota) and the run exits non-zero.
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient, requireDatabaseUrl } from '../db/prisma-client.js';
import { syncRepoSkillsPrisma, GitHubRateLimitError, GitHubRepoGoneError } from '../sync/sync-repo.js';
import { normalizeRepoKey } from '../lib/mirror-screen.js';
import { loadSources, syncAllSourcesPrisma, type MirrorSource, type SyncAllResult, type SourceSyncOutcome } from './sync-sources.js';
import { discoverMirrorCandidates, DISCOVERY_TOKEN_ENV, DEFAULT_MIN_QUALITY_SCORE, type DiscoverResult } from './discovery.js';
import { loadDenylist } from './denylist.js';
import { syncAllConnectedReposPrisma, type ConnectedSyncSummary } from '../sync/connected-repo.js';
import type { BlobStore } from '../blob-store/types.js';
import { createPrismaBlobStore } from '../blob-store/create-blob-store.js';
import { assertDurableBlobStoreForProd } from './require-durable-blob-store.js';

/** Env var holding the sync token (higher core-API limits). */
export const SYNC_TOKEN_ENV = 'SKILLET_MIRROR_GITHUB_TOKEN';

export const NIGHTLY_LOCK_NAME = 'skillet_mirror_nightly';

/** Days back a repo may have been created/pushed and count as "new"/"active". */
const SWEEP_WINDOW_DAYS = 14;

/** The SKILL.md ecosystem's topic tags, swept individually (topics can't be OR'd). */
const DISCOVERY_TOPICS = ['agent-skills', 'claude-skills', 'claude-code-skills'];

function isoDaysAgo(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export interface Phase2Result {
    synced: number;
    failed: number;
    /** Repos that 404 and were retired. Deliberately NOT counted in `failed`:
     *  the retry can never succeed, so it must not hold the exit code red. */
    gone: number;
    notAttempted: number;
    rateLimited: boolean;
    sources: SourceSyncOutcome[];
}

export interface NightlyResult {
    /** False when another run held the advisory lock and this one exited early. */
    lockAcquired: boolean;
    phase1: SyncAllResult | null;
    phase2: Phase2Result | null;
    phase3: DiscoverResult | null;
    /** Self-serve connected repos, re-published on the same daily cadence the
     *  UI promises. Null when an earlier phase hit a rate limit. */
    phase4: ConnectedSyncSummary | null;
    /** null = phase 3 was skipped (rate limit earlier in the run). */
    exitCode: number;
}

export interface NightlyOptions {
    dryRun?: boolean;
    syncToken?: string;
    discoveryToken?: string;
    sources?: MirrorSource[];
    denylist?: Map<string, string>;
    fetchImpl?: typeof fetch;
    /** Injectable dedicated lock client (tests). Defaults to a fresh
     *  single-connection client on DATABASE_URL. Always disconnected here. */
    lockClient?: PrismaClient;
    lockName?: string;
    /** Defaults to createPrismaBlobStore(prisma). Tests inject MemoryBlobStore. */
    blobStore?: BlobStore;
}

/** Single-connection client so GET_LOCK/RELEASE ride one MySQL session. */
function makeLockClient(): PrismaClient {
    const url = requireDatabaseUrl();
    const sep = url.includes('?') ? '&' : '?';
    return createPrismaClient({ databaseUrl: `${url}${sep}connection_limit=1` });
}

async function tryAcquireLock(lockClient: PrismaClient, name: string): Promise<boolean> {
    const rows = await lockClient.$queryRawUnsafe<Array<{ l: unknown }>>(
        'SELECT GET_LOCK(?, 0) AS l', name,
    );
    return Number(rows[0]?.l) === 1;
}

/** Phase 2: sync live queue-approved mirrors not covered by seeds/denylist. */
async function syncDiscoveredMirrors(prisma: PrismaClient, opts: {
    seeds: MirrorSource[];
    denylist: Map<string, string>;
    dryRun: boolean;
    token?: string;
    fetchImpl?: typeof fetch;
    blobStore: BlobStore;
}): Promise<Phase2Result> {
    const result: Phase2Result = { synced: 0, failed: 0, gone: 0, notAttempted: 0, rateLimited: false, sources: [] };
    const seedKeys = new Set(
        opts.seeds.map((s) => normalizeRepoKey(s.repo)).filter((k): k is string => k != null),
    );
    const rows = await prisma.mirror_review_queue.findMany({
        where: { status: 'live' },
        select: { source_repo: true, derived_handle: true, license: true },
        orderBy: { created_at: 'asc' },
    });
    // Dedupe by normalized key; seed file and denylist win over the queue.
    const work: Array<{ handle: string; repo: string; license: string | null }> = [];
    const seen = new Set<string>();
    for (const row of rows) {
        const key = normalizeRepoKey(row.source_repo);
        if (!key || seen.has(key) || seedKeys.has(key) || opts.denylist.has(key))
            continue;
        seen.add(key);
        if (!row.derived_handle) {
            console.warn(`  ! skipping live queue row without a derived handle: ${row.source_repo}`);
            continue;
        }
        work.push({ handle: row.derived_handle, repo: row.source_repo, license: row.license });
    }
    for (let i = 0; i < work.length; i++) {
        const w = work[i]!;
        const [owner, repo] = w.repo.split('/');
        if (!owner || !repo) {
            result.failed++;
            result.sources.push({ handle: w.handle, repo: w.repo, status: 'failed', error: 'invalid repo' });
            continue;
        }
        console.log(`\n@${w.handle}  <-  ${w.repo} (discovered, ${w.license ?? 'license from mirror row'})`);
        try {
            // Approval-time license from the queue row; skill_mirrors fallback.
            const license = w.license
                ?? (await prisma.skill_mirrors.findFirst({
                    where: { source_repo: w.repo },
                    select: { license: true },
                }))?.license
                ?? null;
            const r = await syncRepoSkillsPrisma(prisma, owner, repo, {
                authorHandle: w.handle,
                repoFull: w.repo,
                license,
                blobStore: opts.blobStore,
                ...(opts.token ? { token: opts.token } : {}),
                ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
                dryRun: opts.dryRun,
            });
            result.synced++;
            result.sources.push({ handle: w.handle, repo: w.repo, status: 'ok' });
            console.log(`  +${r.added} ~${r.updated} =${r.unchanged} skip:${r.skipped} (${r.total} skills)`);
        }
        catch (err) {
            if (err instanceof GitHubRateLimitError) {
                result.rateLimited = true;
                result.failed++;
                result.sources.push({ handle: w.handle, repo: w.repo, status: 'failed', error: err.message });
                for (const rest of work.slice(i + 1)) {
                    result.notAttempted++;
                    result.sources.push({ handle: rest.handle, repo: rest.repo, status: 'not-attempted' });
                }
                console.error(`  ! GitHub rate limit reached; ${result.notAttempted} discovered mirrors not attempted`);
                break;
            }
            if (err instanceof GitHubRepoGoneError) {
                // Retiring it, not counting it as a failure. The repo is gone, so
                // every future run would fail on it identically and the job's exit
                // code would stay red for something nobody can fix. Phase 2 only
                // picks up `live` rows, so this also stops the wasted daily call.
                result.gone++;
                result.sources.push({ handle: w.handle, repo: w.repo, status: 'gone', error: err.message });
                console.error(`  ! @${w.handle} repo is gone (404); retiring it from the queue`);
                if (!opts.dryRun) {
                    await prisma.mirror_review_queue
                        .updateMany({ where: { source_repo: w.repo, status: 'live' }, data: { status: 'gone' } })
                        .catch((e: unknown) => {
                            console.error(`    could not retire ${w.repo}: ${(e as Error).message}`);
                        });
                }
                continue;
            }
            console.error(`  ! @${w.handle} failed: ${(err as Error).message}`);
            result.failed++;
            result.sources.push({ handle: w.handle, repo: w.repo, status: 'failed', error: (err as Error).message });
        }
    }
    return result;
}

export async function runNightlyMirrorOps(prisma: PrismaClient, opts: NightlyOptions = {}): Promise<NightlyResult> {
    const dryRun = opts.dryRun ?? false;
    const syncToken = opts.syncToken ?? process.env[SYNC_TOKEN_ENV] ?? process.env.GITHUB_TOKEN;
    if (!syncToken) {
        // Unauthenticated core API is 60 req/hr against ~180 needed; running
        // without a token guarantees a rate-limit abort, so fail at startup.
        throw new Error(`no sync token: set ${SYNC_TOKEN_ENV} (or GITHUB_TOKEN)`);
    }
    assertDurableBlobStoreForProd();
    const blobStore = opts.blobStore ?? createPrismaBlobStore(prisma);
    const discoveryToken = opts.discoveryToken ?? process.env[DISCOVERY_TOKEN_ENV];
    const sources = opts.sources ?? loadSources();
    const denylist = opts.denylist ?? loadDenylist();

    const lockClient = opts.lockClient ?? makeLockClient();
    let lockAcquired = false;
    try {
        lockAcquired = await tryAcquireLock(lockClient, opts.lockName ?? NIGHTLY_LOCK_NAME);
        if (!lockAcquired) {
            console.log('another nightly run holds the lock; exiting');
            // Distinguishable from a clean zero-work run in the log stream.
            console.log(JSON.stringify({ nightly_mirror_ops: { skipped: 'lock-held', exit_code: 0 } }));
            return { lockAcquired: false, phase1: null, phase2: null, phase3: null, phase4: null, exitCode: 0 };
        }

        console.log(`phase 1: seed re-sync (${sources.length} sources)${dryRun ? ' [dry-run]' : ''}`);
        const phase1 = await syncAllSourcesPrisma(prisma, {
            dryRun,
            token: syncToken,
            sources,
            denylist,
            blobStore,
            ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
        });

        let phase2: Phase2Result | null = null;
        if (!phase1.rateLimited) {
            console.log('\nphase 2: discovered-mirror re-sync');
            phase2 = await syncDiscoveredMirrors(prisma, {
                seeds: sources,
                denylist,
                dryRun,
                blobStore,
                ...(syncToken ? { token: syncToken } : {}),
                ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
            });
        }

        // Discovery screening burns the same core-API quota the sync phases
        // exhausted, so a rate-limited run skips phase 3 entirely.
        let phase3: DiscoverResult | null = null;
        const rateLimited = phase1.rateLimited || (phase2?.rateLimited ?? false);
        if (!rateLimited) {
            console.log('\nphase 3: discovery');
            const day = isoDaysAgo(SWEEP_WINDOW_DAYS);
            phase3 = await discoverMirrorCandidates({
                prisma,
                searchQueries: DISCOVERY_TOPICS.flatMap((t) => [
                    `topic:${t} created:>=${day}`,
                    `topic:${t} pushed:>=${day}`,
                ]),
                fromImports: true,
                minQualityScore: DEFAULT_MIN_QUALITY_SCORE,
                denylist,
                ...(discoveryToken ? { token: discoveryToken } : {}),
                ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
                dryRun,
            });
        }

        // Phase 4: self-serve connected repos. These used to sync only when a
        // human connected one or pressed refresh, while every skill page told
        // visitors the source syncs daily. Runs after discovery and is skipped
        // on a rate limit like the rest, since it is ordinary GitHub traffic.
        let phase4: ConnectedSyncSummary | null = null;
        if (!rateLimited && !dryRun) {
            console.log('\nphase 4: connected-repo re-sync');
            phase4 = await syncAllConnectedReposPrisma(prisma, { blobStore });
        }

        const failed = phase1.failed + (phase2?.failed ?? 0) + (phase4?.failed ?? 0);
        const exitCode = failed > 0 || rateLimited ? 1 : 0;
        // Machine-greppable summary, deliberately the LAST stdout line: with
        // autorestart:false the exit code only lands in PM2 logs, so this line
        // is the monitoring hook.
        console.log(JSON.stringify({
            nightly_mirror_ops: {
                dry_run: dryRun,
                rate_limited: rateLimited,
                phase1: {
                    added: phase1.added, updated: phase1.updated, unchanged: phase1.unchanged,
                    skipped: phase1.skipped, failed: phase1.failed, denylisted: phase1.denylisted,
                    not_attempted: phase1.notAttempted, classified: phase1.classified,
                },
                phase2: phase2 ? {
                    synced: phase2.synced, failed: phase2.failed, gone: phase2.gone,
                    not_attempted: phase2.notAttempted,
                } : null,
                phase3: phase3 ? {
                    enqueued: phase3.enqueued.length, skipped: phase3.skipped.length,
                    search_rate_limited: phase3.rateLimited,
                } : null,
                phase4: phase4 ? {
                    synced: phase4.synced, failed: phase4.failed, skipped: phase4.skipped,
                } : null,
                exit_code: exitCode,
            },
        }));
        return { lockAcquired: true, phase1, phase2, phase3, phase4, exitCode };
    }
    finally {
        // Disconnecting closes the dedicated session, which releases the lock
        // deterministically (same session that acquired it).
        await lockClient.$disconnect();
    }
}
